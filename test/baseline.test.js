// One test per BASELINE.md check, named "<ID>: ...", so each check's proof runs alone:
//   node --test --test-name-pattern=SEC-5: test/baseline.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const vm = require('node:vm');
const { spawn, exec } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { apply, reply, lastTitle } = require('../sessions');
const hooks = require('../hooks');
const store = require('../store');
const pipe = require('../pipe');
const ipc = require('../ipc');
const S = require('../update-signature');

const ROOT = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tmp = (name = 'loupe-') => fs.mkdtempSync(path.join(os.tmpdir(), name));
const WIN = process.platform === 'win32';
const PERM = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf x' },
  permission_suggestions: [{ type: 'addRules', rules: [], behavior: 'allow', destination: 'localSettings' }] };
const QUESTION = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } };

// a home with a LOUPE pipe address, a server on it, and the relay's config ("answer permissions on LOUPE" on)
async function fakeLoupe(home, onSock) {
  const addr = pipe.open(path.join(home, '.loupe'));
  if (!WIN) try { fs.unlinkSync(addr); } catch {}
  const appdata = path.join(home, 'AppData');
  fs.mkdirSync(path.join(appdata, 'loupe'), { recursive: true });
  fs.writeFileSync(path.join(appdata, 'loupe', 'config.json'), JSON.stringify({ answerOnIsland: true }));
  const server = net.createServer(onSock);
  await new Promise(r => server.listen(addr, r));
  return { server, env: { ...process.env, USERPROFILE: home, HOME: home, APPDATA: appdata } };
}
const run = (cmd, args, env, input) => new Promise(res => {
  const p = spawn(cmd, args, { env });
  let out = '', err = '';
  p.stdout.on('data', c => { out += c; }); p.stderr.on('data', c => { err += c; });
  p.on('exit', code => res({ code, out, err }));
  p.stdin.end(input);
});

test('SEC-5: an unknown or broken answer never allows; it goes back to the thread', () => {
  for (const bad of ['garbage', undefined, null, {}, 1, ['allow'], 'Allow']) assert.strictEqual(reply(PERM, bad), null, String(bad));
  for (const bad of ['allow', null, ['x'], { 'Q?': 1 }]) assert.strictEqual(reply(QUESTION, bad), null, JSON.stringify(bad));
  assert.strictEqual(reply(PERM, 'allow').hookSpecificOutput.decision.behavior, 'allow');
  assert.strictEqual(reply(PERM, 'deny').hookSpecificOutput.decision.behavior, 'deny');
  assert.deepStrictEqual(reply(QUESTION, { 'Q?': 'yes' }).hookSpecificOutput.updatedInput.answers, { 'Q?': 'yes' });
});

test('INP-1: a broken, missing or unwritable settings file gives defaults and a clear false, never a crash', () => {
  const dir = tmp(), file = path.join(dir, 'config.json'), defs = { sound: true };
  fs.writeFileSync(file, '{"sound": fal');
  assert.deepStrictEqual(store.load(file, defs), defs);
  assert.deepStrictEqual(store.load(path.join(dir, 'missing', 'x.json'), defs), defs);
  fs.writeFileSync(path.join(dir, 'afile'), '');
  let ok;
  assert.doesNotThrow(() => { ok = store.save(path.join(dir, 'afile', 'config.json'), defs); }); // parent is a file
  assert.strictEqual(ok, false);
  const odd = path.join(dir, `Jö ${'x'.repeat(120)} ü.json`);
  assert.strictEqual(store.save(odd, { a: 1 }), true);
  assert.deepStrictEqual(store.load(odd, {}), { a: 1 });
});

test('INP-2: a crash in the middle of saving leaves the old settings whole', () => {
  const file = path.join(tmp(), 'config.json');
  store.save(file, { sound: false, dx: 40 });
  const real = fs.writeFileSync;
  fs.writeFileSync = (f, data, ...rest) => { real(f, String(data).slice(0, 5), ...rest); throw new Error('ENOSPC: disk full'); };
  try { store.save(file, { sound: true, dx: 99, pad: 'x'.repeat(5000) }); } finally { fs.writeFileSync = real; }
  assert.deepStrictEqual(store.load(file, {}), { sound: false, dx: 40 });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['config.json']); // no temp file left
});

test('OPS-8: settings survive a restart (read back by a fresh process)', async () => {
  const file = path.join(tmp(), 'config.json');
  store.save(file, { where: 'above', procs: true });
  const r = await run(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(ROOT, 'store.js'))}).load(process.argv[1], {})))`, file], process.env, '');
  assert.deepStrictEqual(JSON.parse(r.out), { where: 'above', procs: true });
});

test('DATA-3: a settings file from an older LOUPE still opens, with new defaults filled in', () => {
  const dir = tmp(), defs = { closeDelay: 5000, sound: true, volume: 0.7, goo: true };
  const old = path.join(dir, 'old.json');
  fs.writeFileSync(old, JSON.stringify({ sound: false, legacyKey: 1 })); // 0.1-era file: fewer keys, one retired
  assert.deepStrictEqual(store.load(old, defs), { closeDelay: 5000, sound: false, volume: 0.7, goo: true, legacyKey: 1 });
  for (const junk of ['[]', 'null', '"x"', '7']) {
    fs.writeFileSync(old, junk);
    assert.deepStrictEqual(store.load(old, defs), defs, junk);
  }
});

test('MEM-3: one hook connection can not grow LOUPE\'s buffer without end', () => {
  const sock = new EventEmitter(), got = [];
  sock.setEncoding = () => {}; sock.destroyed = false; sock.destroy = () => { sock.destroyed = true; };
  pipe.lines(sock, l => got.push(l));
  sock.emit('data', '{"a":1}\n{"b"');
  sock.emit('data', ':2}\n');
  assert.deepStrictEqual(got, ['{"a":1}', '{"b":2}']);
  const chunk = 'x'.repeat(1 << 16);
  for (let n = 0; n <= pipe.MAX_LINE / chunk.length; n++) sock.emit('data', chunk); // one line past the cap, no newline
  assert.ok(sock.destroyed, 'a line past the cap must drop the connection');
});

test('MEM-4: a huge transcript is read in pieces, 8 MB at most, never whole', () => {
  const MB = 1 << 20, size = 64 * MB, title = '{"type":"agent-name","agentName":"Old name"}';
  let bytes = 0;
  const read = (pos, len) => { bytes += len; return pos === 0 ? title + ' '.repeat(len - title.length) : ' '.repeat(len); };
  assert.strictEqual(lastTitle(read, size), null); // the title sits past the 8 MB it may read
  assert.ok(bytes <= 9 * MB, `read ${Math.round(bytes / MB)} MB of a 64 MB transcript`);
  bytes = 0;
  lastTitle(read, size, size - 100); // later looks: only what was appended
  assert.ok(bytes < 8192);
  const small = '{"type":"agent-name","agentName":"A"}\n{"type":"agent-name","agentName":"JG - QA"}\n';
  assert.strictEqual(lastTitle((p, l) => small.slice(p, p + l), small.length), 'JG - QA');
});

test('MEM-6: memory stays under a ceiling after 50,000 hook events from 50,000 sessions', () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const m = new Map(), big = 'x'.repeat(2048);
  gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 50000; i++) {
    apply(m, { session_id: `s${i}`, cwd: `C:\\P\\proj${i}`, hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: big + i }, orb_ts: i });
  }
  gc(); const grew = (process.memoryUsage().heapUsed - before) / (1 << 20);
  assert.ok(m.size <= 200, `${m.size} sessions held`);
  assert.ok(grew < 20, `heap grew ${grew.toFixed(1)} MB`);
});

test('EXIT-3: hooks from an old or dev-folder LOUPE are found and removed, only ~/.loupe/relay.js stays', () => {
  const relay = 'C:\\Users\\X\\.loupe\\relay.js';
  const settings = { hooks: { Stop: [
    { hooks: [{ type: 'command', command: 'node "C:/Users/X/Documents/Claude/Projects/LOUPE/relay.js"', timeout: 5 }] },
    { hooks: [{ type: 'command', command: 'node C:/Users/X/Documents/Claude/Projects/LOUPE/.claude/worktrees/a-b/relay.js' }] },
  ] } };
  assert.strictEqual(hooks.check(settings, relay).stale.length, 2);
  const fixed = JSON.stringify(hooks.fix(settings, relay));
  assert.ok(!/Projects/.test(fixed), 'a hook still points into a dev folder');
  assert.ok(hooks.check(hooks.fix(settings, relay), relay).ok);
});

test('EXIT-5: logs and settings backups stay bounded', () => {
  const dir = tmp();
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dir, `settings.json.bak-loupe-2026-11-${String(10 + i)}T00-00-00-000Z`), '{}');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  store.prune(dir, 'settings.json.bak-loupe-', 3);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['settings.json', 'settings.json.bak-loupe-2026-11-17T00-00-00-000Z',
    'settings.json.bak-loupe-2026-11-18T00-00-00-000Z', 'settings.json.bak-loupe-2026-11-19T00-00-00-000Z']);
  const log = path.join(dir, 'reap.log');
  fs.writeFileSync(log, Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n') + '\n');
  store.capLog(log, 64 << 10);
  const kept = fs.readFileSync(log, 'utf8');
  assert.ok(kept.length <= 64 << 10 && kept.startsWith('line ') && kept.endsWith('line 19999\n'));
});

test('EXIT-6: when LOUPE dies holding a prompt, the relay exits at once with no answer (Claude asks in the thread)', async () => {
  const home = tmp();
  const { server, env } = await fakeLoupe(home, s => s.once('data', () => s.destroy())); // LOUPE gone mid-prompt
  try {
    const t0 = Date.now();
    const r = await run(process.execPath, [path.join(ROOT, 'relay.js')], env, JSON.stringify({ ...PERM, session_id: 'x' }));
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.out, '');
    assert.ok(Date.now() - t0 < 3000);
  } finally { server.close(); }
});

test('DATA-2: errors and crashes land in a local log with their stack', () => {
  const file = path.join(tmp(), 'loupe.log');
  const log = store.logger(file);
  log('crash', new Error('boom in main'));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /crash Error: boom in main/);
  assert.match(text, /baseline\.test\.js/); // the stack, so it can be traced
  assert.match(src('main.js'), /process\.on\('uncaughtException', e => crash\(/);
});

test('REL-2: a truncated or altered download is refused, and nothing installs without the user', async () => {
  const crypto = require('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const body = Buffer.alloc(1 << 20, 7), file = path.join(tmp(), 'setup.exe');
  fs.writeFileSync(file, body.subarray(0, body.length - 1000)); // cut short
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const u = new EventEmitter();
  S.guard(u, { app: 'LOUPE', sigUrl: v => `https://example.test/${v}.sig`, log: () => {}, key: pub });
  u.emit('update-available', { version: '9.0.0' });
  const real = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => crypto.sign(null, Buffer.from(`LOUPE 9.0.0 ${sha}\n`), privateKey).toString('base64') });
  try { assert.notStrictEqual(await u.verifySignature(file), null); } finally { global.fetch = real; }
  const main = src('main.js');
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false;/);
  assert.match(main, /buttons: \['Restart to update', 'Later'\]/);
});

test('NET-1: a stalled signature server fails the update after the timeout instead of hanging', async () => {
  const file = path.join(tmp(), 'setup.exe');
  fs.writeFileSync(file, 'x');
  const u = new EventEmitter();
  S.guard(u, { app: 'LOUPE', sigUrl: v => v, log: () => {}, timeoutMs: 200 });
  u.emit('update-available', { version: '1.0.0' });
  const real = global.fetch;
  global.fetch = (url, opt = {}) => new Promise((_, rej) => opt.signal && opt.signal.addEventListener('abort', () => rej(opt.signal.reason)));
  try {
    const r = await Promise.race([u.verifySignature(file), new Promise(res => setTimeout(res, 3000, 'hung')).then(x => x)]);
    assert.notStrictEqual(r, 'hung', 'the signature fetch never gave up');
    assert.notStrictEqual(r, null);
  } finally { global.fetch = real; }
});

test('PLAT-1: hooks work from a home with spaces, non-ASCII and a long path', async () => {
  const home = path.join(tmp(), `Jö Ünï cødé ${'long '.repeat(20).trim()}`);
  fs.mkdirSync(home);
  const relay = path.join(home, '.loupe', 'relay.js');
  let got = '';
  const { server, env } = await fakeLoupe(home, s => { s.setEncoding('utf8'); s.on('data', c => { got += c; }); });
  fs.copyFileSync(path.join(ROOT, 'relay.js'), relay);
  try {
    await new Promise(res => {
      const p = exec(hooks.command(relay), { env }, () => res());
      p.stdin.end(JSON.stringify({ session_id: 's', hook_event_name: 'Stop', cwd: 'C:\\Users\\Jö\\Мой проект' }));
    });
    await new Promise(r => setTimeout(r, 100));
    assert.ok(got, 'the hook command did not reach LOUPE from this path');
    const m = new Map(); apply(m, JSON.parse(got.trim()));
    assert.strictEqual(m.get('s').name, 'Мой проект');
  } finally { server.close(); }
});

test('ABU-13: main, not the page, decides what the page may change or kill', () => {
  assert.deepStrictEqual(ipc.cfgPatch({ sound: false, answerOnIsland: true, answerQuestions: true, procs: true }), { sound: false, procs: true });
  assert.deepStrictEqual(ipc.cfgPatch(null), {});
  assert.deepStrictEqual(ipc.killList(['1234', '4@x', '12345@2026-11-01T10:00:00', 'rm -rf', 7, '99999999']), ['1234', '12345@2026-11-01T10:00:00']);
  const main = src('main.js');
  assert.match(main, /ipcMain\.on\('config', \(_, p\) => \{ const patch = ipc\.cfgPatch\(p\);/);
  assert.match(main, /pids = ipc\.killList\(pids\);/);
});

test('WEB-1: the page has a strict CSP and every window is sandboxed and locked to its page', () => {
  const csp = src('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'self'/);
  assert.ok(!/unsafe-eval/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), csp);
  const main = src('main.js'), wins = main.match(/new BrowserWindow\(/g).length;
  assert.strictEqual(main.match(/contextIsolation: true, nodeIntegration: false, sandbox: true/g).length, wins);
  assert.strictEqual(main.match(/lockDown\((win|glass)\);/g).length, wins);
});

test('WEB-7: process and session text is escaped before it goes into the page as HTML', () => {
  const r = src('renderer.js');
  const esc = vm.runInNewContext(r.match(/const esc = (t => [^\n]+);/)[1]);
  assert.strictEqual(esc('<img src=x onerror="alert(1)">&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
  for (const t of ['r.Cmd', 'r.Label || r.Name', 'set[0].Label || set[0].Name', 'g.name', 'g.key', 'presult', 'r.Ports.split']) {
    assert.ok(r.includes(`esc(${t}`), `${t} is shown unescaped`);
    assert.ok(!r.includes(`\${${t}`), `${t} is shown unescaped`);
  }
});

test('A11Y-2: motion stops for people who ask for reduced motion', () => {
  assert.match(src('index.html'), /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ transition-duration: 0s !important; animation-duration: 0s !important; \} \}/);
  assert.ok((src('renderer.js').match(/prefers-reduced-motion: reduce/g) || []).length >= 2); // the orb and the panel fold
});

test('PRIV-2: reap.log masks tokens and keys in the command lines it records', { skip: !WIN }, async () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'));
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(ROOT, 'reap', 'reap.ps1'), '-SelfTest'], { ...process.env, USERPROFILE: home }, '');
  assert.match(r.out, /self-test ok/, r.err);
  const log = fs.readFileSync(path.join(home, '.claude', 'reap.log'), 'utf8');
  assert.match(log, /killed pid=\d+.*--api-token=\*\*\*/);
  assert.ok(!/-secret/.test(log), log);
});
