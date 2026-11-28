// Hush add-on (Windows): LOUPE runs Hush (loupedesk/hush) as `Hush.exe --headless`, so one tray icon covers both.
// LOUPE fetches the release exe, checks its .sig against the release keys (Windows Hello, or the ed25519 recovery key), and
// talks to it over stdio: JSON status lines out, commands in. Hush holds a per-login lock, so when the standalone
// Hush app is running the sidecar exits with code 3 and LOUPE leaves it be (Discord is never muted twice).
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { signed, HELLO, RECOVERY } = require('./update-signature');

const API = 'https://api.github.com/repos/loupedesk/hush/releases/latest';
const DAY = 24 * 3600e3, RETRY = 60e3;
const newer = (a, b) => { // 'x.y.z' strings: is a newer than b
  const x = a.split('.').map(Number), y = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// get(url) -> Buffer; injectable for the self-check
async function latest(get) {
  const rel = JSON.parse(await get(API));
  const v = String(rel.tag_name || '').replace(/^v/, ''), a = n => (rel.assets || []).find(x => x.name === n);
  const exe = a(`hush-v${v}.exe`), sig = a(`hush-v${v}.exe.sig`);
  if (!v || !exe || !sig) throw new Error(`Hush ${v || '?'} has no signed exe`);
  return { v, exe: exe.browser_download_url, sig: sig.browser_download_url };
}

// download rel's exe to `to` only if its signature checks out
async function fetchSigned(rel, to, get, key = [HELLO, RECOVERY]) {
  const data = await get(rel.exe), sig = String(await get(rel.sig));
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  if (!signed('Hush', rel.v, sha, sig, key)) throw new Error(`Hush ${rel.v} is not signed`);
  fs.writeFileSync(to, data);
}

const httpGet = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': 'LOUPE' }, signal: AbortSignal.timeout(120e3) });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
};

function create({ dir, onChange, log = () => {}, get = httpGet }) {
  const exe = path.join(dir, 'Hush.exe'), verFile = path.join(dir, 'version.txt');
  const have = () => { try { return fs.existsSync(exe) && fs.readFileSync(verFile, 'utf8').trim(); } catch { return ''; } };
  // phase: off | installing | running | standalone | failed. The rest comes from Hush's own status line.
  let st = { phase: 'off', version: have() }, child = null, want = false, retry = null, daily = null, busy = false;
  const set = p => { st = { ...st, ...p }; onChange(st); };

  function start() {
    if (child || !want || !fs.existsSync(exe)) return;
    const c = child = spawn(exe, ['--headless'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let buf = '';
    c.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        try {
          const m = JSON.parse(buf.slice(0, i));
          if (m.status !== 'standalone') set({ phase: 'running', ...m, note: st.note });
        } catch {}
      }
    });
    c.on('error', e => { log(`hush: ${e.message}`); if (child === c) child = null; });
    c.on('exit', code => {
      if (child === c) child = null;
      st.holding = false; // a dead Hush holds nothing; Hush restores what it can at its next start
      if (!want || c.stopped) return; // LOUPE asked it to stop (update, quit, off)
      // 3: the standalone Hush holds the lock. Anything else is a crash: start again, a minute later either way.
      set(code === 3 ? { phase: 'standalone' } : { phase: 'failed', note: 'Hush stopped, starting again' });
      clearTimeout(retry); retry = setTimeout(start, RETRY);
    });
  }

  // ask Hush to quit, so it gives back any mute it holds; a hard kill only if it does not answer
  const stop = () => new Promise(res => {
    const c = child; child = null;
    if (!c || c.exitCode !== null) return res();
    c.stopped = true;
    const t = setTimeout(() => { c.kill(); res(); }, 8000); // Hush waits up to 5 s for Discord to take the unmute
    c.once('exit', () => { clearTimeout(t); res(); });
    try { c.stdin.end('quit\n'); } catch { c.kill(); }
  });

  // fetch a newer signed release; swap it in only while Hush is not holding a mute
  async function update(manual) {
    if (busy) return; busy = true;
    try {
      const rel = await latest(get);
      if (!newer(rel.v, have())) { if (manual) { set({ note: `Hush ${have()} is up to date` }); setTimeout(() => st.note.endsWith('up to date') && set({ note: '' }), 10e3); } return; }
      if (have()) set({ note: `Downloading Hush ${rel.v}` });
      fs.mkdirSync(dir, { recursive: true });
      await fetchSigned(rel, exe + '.new', get);
      while (want && child && st.holding) await new Promise(r => setTimeout(r, 1000));
      await stop();
      fs.renameSync(exe + '.new', exe); fs.writeFileSync(verFile, rel.v); // replaces in place, so a locked file keeps the old exe
      set({ version: rel.v, note: '' });
      log(`hush: updated to ${rel.v}`);
    } catch (e) {
      log(`hush: ${e.message}`);
      fs.rmSync(exe + '.new', { force: true });
      if (have()) set({ note: /not signed/.test(e.message) ? `${e.message}, kept ${have()}` : manual ? 'Hush update check failed' : st.note });
      else throw e;
    } finally { busy = false; start(); }
  }

  async function enable() {
    want = true;
    const had = have();
    if (!had) {
      set({ phase: 'installing', note: '' });
      try { await update(false); } catch (e) { want = false; return set({ phase: 'failed', note: /not signed/.test(e.message) ? 'Hush could not be installed: not signed' : 'Hush could not be installed' }); }
      if (!want) return; // unticked while it downloaded
    }
    start();
    clearInterval(daily); daily = setInterval(() => update(false).catch(() => {}), DAY);
    if (had) update(false).catch(() => {});
  }

  async function disable() {
    want = false; clearTimeout(retry); clearInterval(daily);
    await stop();
    set({ phase: 'off', note: '' });
  }

  const send = cmd => { try { child && child.stdin.write(cmd + '\n'); } catch {} };
  return { enable, disable, stop, send, update, state: () => st };
}

module.exports = { create, latest, fetchSigned, newer };
