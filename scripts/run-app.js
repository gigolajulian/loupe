// Starts this copy of LOUPE in a scratch profile for checks (exit, memory, CPU, start time). Windows only.
// Scratch home, AppData and userData: it never touches the real ~/.loupe (live sessions' hooks), settings or lock.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const hooks = require('../hooks');

const ROOT = path.join(__dirname, '..');

// every process, with its parent, command line, private bytes, working set and CPU time (100 ns units)
function procs() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,PrivatePageCount,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 64 << 20, windowsHide: true });
  return JSON.parse(out.replace(/[\x00-\x1f]/g, ' ')); // PowerShell 5.1 leaves control characters in command lines unescaped
}
// pid and everything under it
function tree(all, pid) {
  const out = [], stack = [pid];
  while (stack.length) {
    const p = stack.pop(), me = all.find(x => x.ProcessId === p);
    if (me) out.push(me);
    for (const c of all) if (c.ParentProcessId === p && c.ProcessId !== p) stack.push(c.ProcessId);
  }
  return out;
}

function launch({ cfg = {}, env: extra = {}, args = [] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'loupe-run-'));
  const appdata = path.join(home, 'AppData', 'Roaming'), userData = path.join(appdata, 'loupe');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  // hooks already set and the first-run choices made, so no dialog opens
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(hooks.fix({}, path.join(home, '.loupe', 'relay.js'))));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ procsAsked: true, ...cfg }));
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: appdata, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), LOUPE_USERDATA: userData, ...extra };
  const electron = require('electron');
  const t0 = Date.now();
  const proc = spawn(electron, [ROOT, ...args], { env, stdio: 'ignore' });
  const pipeFile = path.join(home, '.loupe', 'pipe');
  return {
    proc, home, env, t0, electron,
    // resolves with ms from launch until LOUPE takes a hook event
    ready: async (limit = 30e3) => {
      while (Date.now() - t0 < limit) {
        try {
          const addr = fs.readFileSync(pipeFile, 'utf8').trim();
          await new Promise((res, rej) => { const s = net.connect(addr, () => s.end('{}\n', res)); s.on('error', rej); });
          return Date.now() - t0;
        } catch { await new Promise(r => setTimeout(r, 50)); }
      }
      throw new Error('LOUPE did not start');
    },
    send: ev => new Promise((res, rej) => {
      const s = net.connect(fs.readFileSync(pipeFile, 'utf8').trim(), () => s.end(JSON.stringify(ev) + '\n', res));
      s.on('error', rej);
    }),
    // the tray's Quit, through a second instance
    quit: () => new Promise(res => spawn(electron, [ROOT, '--quit'], { env, stdio: 'ignore' }).on('exit', res)),
    exited: () => new Promise(res => (proc.exitCode !== null ? res() : proc.on('exit', res))),
  };
}

module.exports = { launch, procs, tree, ROOT };
