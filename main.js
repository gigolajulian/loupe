const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, nativeTheme, shell, dialog, powerMonitor } = require('electron');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { apply, view, settle, reply, lastTitle } = require('./sessions');
const hooks = require('./hooks');
const pipe = require('./pipe');
const store = require('./store');
const ipc = require('./ipc');

const MAC = process.platform === 'darwin';
// hooks run the relay from here, not from inside the app, so every update reaches it
const RELAY = path.join(os.homedir(), '.loupe', 'relay.js');
const W = 760, H = 460;
const sessions = new Map();
const pending = new Map(); // req -> { sock, ev }: hooks waiting for an answer
let seq = 0, lastEvent = 0;
// Claude's own window is in front: Claude owns every prompt. New ones go straight to the thread, and ones LOUPE holds
// go back to it the moment Claude comes to front, so a question never waits on both sides (#14).
let claudeFront = false;
let win, tray;

// LOUPE_USERDATA (dev, scripts/run-app.js): a scratch profile, so a test copy never shares the real one's lock or settings
if (process.env.LOUPE_USERDATA) app.setPath('userData', process.env.LOUPE_USERDATA);
if (!app.requestSingleInstanceLock() || process.argv.includes('--quit')) process.exit(0); // --quit with no copy running: nothing to do
// errors and crashes to userData/loupe.log (capped), so a failure can be traced; nothing leaves the PC
const crash = store.logger(path.join(app.getPath('userData'), 'loupe.log'));
process.on('uncaughtException', e => crash('crash', e));
process.on('unhandledRejection', e => crash('rejection', e));
// `LOUPE --check-hooks` opens the hook check, `--fix-hooks` fixes first (for install prompts); also in the running copy.
// `LOUPE --quit` closes the running copy the way the tray's Quit does.
const hookArgs = argv => {
  if (argv.includes('--quit')) app.quit();
  else if (argv.includes('--fix-hooks')) hookCheck(true); else if (argv.includes('--check-hooks')) hookCheck();
};
app.on('second-instance', (_, argv) => hookArgs(argv));
if (MAC) app.dock.hide(); // the packaged app has LSUIElement; this covers npm start
else app.setAppUserModelId('com.juliangigola.loupe'); // Windows groups its icon and notifications under LOUPE

// Mac: the notch's size in points, from NSScreen (macOS 12+). LOUPE_NOTCH=WxH forces it, also on Windows to preview.
// No notch: a notch-sized island over the middle of the menu bar.
function notch() {
  if (process.env.LOUPE_NOTCH) { const [w, h] = process.env.LOUPE_NOTCH.split('x').map(Number); return { w, h }; }
  if (!MAC) return null;
  try {
    const n = JSON.parse(require('child_process').execFileSync('osascript', ['-l', 'JavaScript', '-e',
      "ObjC.import('AppKit'); const s = $.NSScreen.screens.objectAtIndex(0), l = s.auxiliaryTopLeftArea, r = s.auxiliaryTopRightArea;" +
      'JSON.stringify({ h: s.safeAreaInsets.top, w: s.frame.size.width - l.size.width - r.size.width })'], { encoding: 'utf8', timeout: 3000 }));
    if (n.h > 0 && n.w > 0) return { w: Math.round(n.w), h: Math.round(n.h) };
  } catch {}
  const d = screen.getPrimaryDisplay();
  return { w: 180, h: d.workArea.y - d.bounds.y || 24 }; // menu bar height; 0 when it auto-hides
}

// Returns () => true while the foreground window is someone else's topmost window covering the whole
// display LOUPE sits on, e.g. the Snipping Tool's dimmed overlay. Raising over it breaks the snip.
function overlayCheck(own) {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const fg = user32.func('intptr_t __stdcall GetForegroundWindow()');
  const exStyle = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
  const rectOf = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
  const mine = Number(own.getNativeWindowHandle().readBigUInt64LE(0));
  return () => {
    const h = Number(fg());
    if (!h || h === mine || !(Number(exStyle(h, -20 /* GWL_EXSTYLE */)) & 0x8 /* WS_EX_TOPMOST */)) return false;
    const r = {};
    if (!rectOf(h, r)) return false;
    const d = screen.getDisplayMatching(own.getBounds());
    const p = screen.dipToScreenRect(own, d.bounds); // physical px, like GetWindowRect
    return r.left <= p.x && r.top <= p.y && r.right >= p.x + p.width && r.bottom >= p.y + p.height;
  };
}

// state goes to the renderer only when it changed, plus a 30 s heartbeat for "idle 5m" ages. Sending it every
// second re-rendered the panel every second.
let sentState = '', sentFront = null, sentAt = 0;
function push() {
  if (!win || win.isDestroyed()) return;
  // one owner per prompt: a held hook with no card that can answer it (a second relay hook, a replaced or ended
  // session) goes back to the thread, and a card whose hook is gone stops offering Submit
  const shown = new Set([...sessions.values()].map(s => s.ask && s.ask.req).filter(Boolean));
  for (const [req, p] of pending) if (!shown.has(req)) { pending.delete(req); p.sock.end('null\n'); }
  for (const s of sessions.values()) if (s.ask && s.ask.req && !pending.has(s.ask.req)) s.ask.req = undefined;
  if (claudeFront !== sentFront) { sentFront = claudeFront; win.webContents.send('front', claudeFront); }
  const list = view(sessions), json = JSON.stringify(list), now = Date.now();
  if (json === sentState && now - sentAt < 30e3) return;
  sentState = json; sentAt = now;
  win.webContents.send('state', list);
}

// the session's title (the app's rename, e.g. "JG - QA") is the last agent-name line in its transcript (sessions.js
// lastTitle reads at most 8 MB). Then only what was appended since. Reading the whole file held hundreds of MB.
function readTitle(s, file) {
  s.title = s.title || '';
  if (s.titleBusy) return;
  s.titleBusy = true;
  fs.open(file, 'r', (err, fd) => {
    if (err) return void (s.titleBusy = false);
    try {
      const size = fs.fstatSync(fd).size;
      const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b.toString('utf8'); };
      const t = lastTitle(read, size, s.titleFile === file ? s.titleAt : -1);
      s.titleFile = file; s.titleAt = size;
      if (t !== null) { s.title = t; push(); }
    } catch {} finally { fs.close(fd, () => {}); s.titleBusy = false; }
  });
}

// Windows: which claude.exe a hook came from. The hook runs under a short-lived bash, so walk up the parent
// chain right away, while it still exists. One Toolhelp snapshot, no child process.
let parentsOf = () => null, procsOn = false; // procsOn mirrors cfg.procs (Windows)
if (!MAC) try {
  const koffi = require('koffi');
  const k32 = koffi.load('kernel32.dll');
  const PE = koffi.struct('PROCESSENTRY32W', { dwSize: 'uint32', cntUsage: 'uint32', th32ProcessID: 'uint32', th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32', cntThreads: 'uint32', th32ParentProcessID: 'uint32', pcPriClassBase: 'int32', dwFlags: 'uint32', szExeFile: koffi.array('char16_t', 260, 'String') });
  const snap = k32.func('intptr_t __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)');
  const first = k32.func('bool __stdcall Process32FirstW(intptr_t h, _Inout_ PROCESSENTRY32W *e)');
  const next = k32.func('bool __stdcall Process32NextW(intptr_t h, _Inout_ PROCESSENTRY32W *e)');
  const close = k32.func('bool __stdcall CloseHandle(intptr_t h)');
  parentsOf = () => {
    const h = snap(2 /* TH32CS_SNAPPROCESS */, 0), map = new Map();
    if (h === -1 || !h) return null;
    try {
      const e = { dwSize: koffi.sizeof(PE) };
      for (let ok = first(h, e); ok; ok = next(h, e)) map.set(e.th32ProcessID, { ppid: e.th32ParentProcessID, exe: e.szExeFile });
    } finally { close(h); }
    return map;
  };
} catch (e) { console.log('process walk off', e.message); }
function claudePid(ppid) {
  const map = parentsOf();
  for (let pid = ppid, n = 0; map && pid && n < 8; n++) {
    const p = map.get(pid);
    if (!p) return 0;
    if (/^claude\.exe$/i.test(p.exe)) return pid;
    pid = p.ppid;
  }
  return 0;
}

// no keyboard or mouse for 2 minutes: held prompts go back to the thread, so a phone or a later look at the app sees them
const AWAY_S = 120;
const away = () => powerMonitor.getSystemIdleTime() >= AWAY_S;
function releaseIfAway() {
  if (!pending.size || !away()) return;
  release();
}
function setFront(on) {
  if (on === claudeFront) return;
  claudeFront = on;
  if (process.env.LOUPE_SNAP) console.log('claude in front:', on);
  if (on && !process.env.LOUPE_HOLD) release(); else push(); // release() pushes
}
// every held prompt back to Claude Code, which then asks in the thread. The card stays, mirrored.
function release() {
  for (const [req, p] of pending) {
    pending.delete(req);
    p.sock.end('null\n'); // no decision: Claude Code asks in the thread
    for (const s of sessions.values()) if (s.ask && s.ask.req === req) s.ask.req = undefined; // keep the card, mirrored
  }
  push();
}

function listen() {
  const server = net.createServer(sock => {
    pipe.lines(sock, line => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      lastEvent = Date.now();
      // away, or Claude in front: straight to the thread, mirrored
      // LOUPE_HOLD=1 (dev): hold anyway, to test the card while Claude is in front
      if (ev.orb_wait && !process.env.LOUPE_HOLD && (away() || claudeFront)) { ev.orb_wait = false; sock.end('null\n'); }
      if (ev.orb_wait) {
        const req = ev.orb_req = String(++seq);
        pending.set(req, { sock, ev });
        if (process.env.LOUPE_SNAP) console.log('wait', new Date().toISOString(), ev.hook_event_name, ev.tool_name, ev.orb_entry);
        // closed without our answer: decided in the app, timed out, or session stopped
        sock.on('close', () => {
          if (!pending.delete(req)) return;
          if (process.env.LOUPE_SNAP) console.log('closed unanswered', new Date().toISOString(), req);
          settle(sessions, req); push();
        });
      }
      apply(sessions, ev);
      const s = sessions.get(ev.session_id);
      // only while Processes is on, and 3 tries per session: the hook's short-lived bash can be gone already
      if (s && !s.pid && ev.orb_ppid && procsOn && (s.pidTries = (s.pidTries || 0) + 1) <= 3) {
        s.pid = claudePid(ev.orb_ppid);
        if (process.env.LOUPE_SNAP) console.log('session pid', s.name, ev.orb_ppid, '->', s.pid);
      }
      if (s && ev.transcript_path && (s.title === undefined || ev.hook_event_name === 'UserPromptSubmit')) readTitle(s, ev.transcript_path);
      push();
    });
    sock.on('error', () => {});
  });
  // a private address, written to ~/.loupe/pipe for relay.js (pipe.js). Opened here, after the single-instance lock.
  const addr = pipe.open(path.dirname(RELAY));
  if (MAC) try { fs.unlinkSync(addr); } catch {} // stale socket from a crash; the single-instance lock means no live one
  server.on('error', e => console.log('pipe failed', e.message)); // the island keeps running; hooks fall back to the thread
  server.listen(addr);
}

// tray "Check Claude Code hooks": node, the 10 relay hooks, leftovers, last event. Fix backs up settings.json first.
// onlyIfBad: the launch check, which stays quiet when everything is set
function hookCheck(autoFix, onlyIfBad) {
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  let settings = {}, bad = '';
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') bad = e.message; }
  let node = '';
  try { // Mac: a Finder-launched app has a bare PATH, a login shell sees what the hooks see
    node = (MAC ? require('child_process').execFileSync('/bin/zsh', ['-lc', 'node -v'], { encoding: 'utf8', timeout: 5000 })
      : require('child_process').execFileSync('node', ['-v'], { encoding: 'utf8', timeout: 5000, windowsHide: true })).trim();
  } catch {}
  const r = hooks.check(settings, RELAY);
  const ago = lastEvent ? `${Math.round((Date.now() - lastEvent) / 1000)} s ago` : 'none since LOUPE started';
  const lines = [
    `node: ${node || 'not found, install Node.js'}`,
    `relay: ${RELAY.replace(/\\/g, '/')}${fs.existsSync(RELAY) ? '' : ' (missing)'}`,
    bad ? `settings.json can't be read: ${bad}` : '',
    '', ...r.events.map(e => `${e.ok ? 'ok' : e.count > 1 ? 'twice' : 'missing'}   ${e.name}`),
    ...(r.stale.length ? ['', 'Old relay paths:', ...r.stale] : []),
    ...(r.coucou.length ? ['', 'Coucou hooks:', ...r.coucou] : []),
    '', `Last event: ${ago}`,
  ];
  const ok = r.ok && !!node && !bad;
  const fixable = !r.ok && !bad;
  if (onlyIfBad && ok) return;
  (autoFix && fixable ? Promise.resolve({ response: 0 }) : dialog.showMessageBox({
    type: ok ? 'info' : 'warning', title: 'LOUPE', message: ok ? 'Claude Code hooks are set' : 'Claude Code hooks need a look',
    detail: lines.filter((l, i) => l || lines[i - 1]).join('\n') + (fixable ? '\n\nFix hooks backs up settings.json, removes old LOUPE and Coucou hooks and adds the 10 LOUPE hooks. Other hooks stay.' : ''),
    buttons: fixable ? ['Fix hooks', 'Close'] : ['Close'], defaultId: 0, cancelId: fixable ? 1 : 0, noLink: true,
  })).then(({ response }) => {
    if (!fixable || response !== 0) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-loupe-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      store.prune(path.dirname(file), 'settings.json.bak-loupe-', 3);
      if (!store.save(file, JSON.stringify(hooks.fix(settings, RELAY), null, 2) + '\n')) throw new Error(`can't write ${file}`);
    } catch (e) { return dialog.showMessageBox({ type: 'error', title: 'LOUPE', message: 'Fix failed', detail: e.message }); }
    hookCheck(); // show the result
  });
}

// The windows only show LOUPE's own page: no navigation away, no popups; http(s) links open in the browser.
const httpUrl = u => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
function lockDown(w) {
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => { if (httpUrl(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  try { fs.mkdirSync(path.dirname(RELAY), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'relay.js'), RELAY); }
  catch (e) { console.log('relay copy failed', e.message); }
  const d = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    width: W, height: H, x: Math.round(d.x + (d.width - W) / 2), y: d.y,
    frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
    // Mac: a panel floats over full-screen apps; larger-than-screen lets a frameless window sit over the menu bar at y=0
    ...(MAC ? { type: 'panel', enableLargerThanScreen: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', // cues play unclicked
    },
  });
  lockDown(win);
  win.webContents.on('render-process-gone', (_, d) => crash('renderer gone', d.reason));
  if (MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Windows drops topmost when other apps take focus or raise their own topmost windows: re-assert it,
  // except over a full-screen topmost window in front (the Snipping Tool overlay, a full-screen game)
  const coveredByOverlay = MAC ? () => false : overlayCheck(win);
  let held = false;
  const raise = () => {
    if (win.isDestroyed()) return;
    const covered = coveredByOverlay();
    if (process.env.LOUPE_SNAP && covered !== held) console.log('overlay in front:', covered);
    held = covered;
    if (covered) return;
    win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop();
  };
  raise();
  win.on('always-on-top-changed', raise);
  setInterval(raise, 1500);
  win.setIgnoreMouseEvents(true, { forward: true });
  const n = notch();
  win.loadFile('index.html', n ? { query: { notch: `${n.w}x${n.h}` } } : {});

  // Mac: the open panel's surface is a native frosted window just under LOUPE's own (a web page can't blur the
  // desktop). The renderer keeps it on the island's rect while open; null hides it.
  let glass = null;
  if (MAC) {
    nativeTheme.themeSource = 'dark'; // LOUPE's text is light: keep the material dark in light mode too
    glass = new BrowserWindow({
      show: false, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, type: 'panel',
      vibrancy: 'hud', visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true, hasShadow: false, width: 100, height: 100, // no shadow: it reads as part of the menu bar
      enableLargerThanScreen: true, // its top edge sits above the screen, so only the bottom corners show rounded
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    lockDown(glass);
    glass.setIgnoreMouseEvents(true);
    glass.setAlwaysOnTop(true, 'pop-up-menu'); // over the menu bar, so panel and bar read as one surface; LOUPE's own window stays above
    glass.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // tint: the menu bar's colour over this Mac's wallpaper (an Aerial, so there is no image to sample); LOUPE_TINT=r,g,b,a overrides
    const tint = process.env.LOUPE_TINT || '18,44,70,.45';
    glass.loadURL(`data:text/html,<style>html{background:rgba(${tint})}</style>`);
  }
  // Mac: a small helper (mac/menubar.swift) reports where the front app's menus end and where the menu bar icons
  // start; the renderer slides the left ear out of the way when menus reach it. Needs Accessibility for LOUPE.
  let axTrusted = null;   // Mac: whether the menu bar helper has Accessibility (null until it says)
  if (MAC) {
    const bin = app.isPackaged ? path.join(process.resourcesPath, 'menubar') : path.join(__dirname, 'mac', 'bin', 'menubar');
    let mb = null, lastMenubar = null;
    const send = () => { if (lastMenubar && !win.isDestroyed()) { const x = win.getBounds().x; win.webContents.send('menubar', { right: lastMenubar.right - x, status: lastMenubar.status - x }); } };
    const startMenubar = () => {
      if (!fs.existsSync(bin)) return console.log('menubar helper missing', bin);
      // macOS's Accessibility dialog once ever (a marker in userData). After that a missing grant shows in the tray.
      const marker = path.join(app.getPath('userData'), 'asked-accessibility');
      const first = !fs.existsSync(marker);
      if (first) try { fs.writeFileSync(marker, new Date().toISOString()); } catch {}
      mb = require('child_process').spawn(bin, first ? ['--prompt'] : [], { stdio: ['pipe', 'pipe', 'ignore'] });
      let buf = '';
      mb.stdout.on('data', d => {
        buf += d; const lines = buf.split('\n'); buf = lines.pop();
        for (const l of lines) try {
          const m = JSON.parse(l);
          if (process.env.LOUPE_SNAP) console.log('menubar', l);
          if (axTrusted !== !!m.trusted) { axTrusted = !!m.trusted; try { menu(); } catch {} }
          if (typeof m.front === 'string') setFront(m.front === 'com.anthropic.claudefordesktop');
          if (m.trusted) { lastMenubar = m; send(); }
        } catch {}
      });
      mb.on('exit', () => { mb = null; if (!quitting) setTimeout(startMenubar, 5000); });
    };
    let quitting = false;
    app.on('before-quit', () => { quitting = true; if (mb) mb.kill(); });
    win.webContents.on('did-finish-load', send);
    startMenubar();
  }

  ipcMain.on('glass', (_, r) => {
    if (!glass) return;
    if (!r) return glass.hide();
    const o = win.getBounds(), z = win.webContents.getZoomFactor(); // renderer px are CSS px: scale by the Size zoom
    glass.setBounds({ x: Math.round(o.x + r.x * z), y: Math.round(o.y + r.y * z), width: Math.round(r.w * z), height: Math.round(r.h * z) });
    if (!glass.isVisible()) { glass.showInactive(); win.moveTop(); }
  });

  // island under the cursor takes clicks, the rest of the window passes them through
  // a fast exit can leave the whole window between two mouse events, and then the island never gets mouseleave
  // and the panel stays open. While hovered, check the cursor and send the leave ourselves.
  let hoverPoll = null;
  ipcMain.on('hover', (_, on) => {
    win.setIgnoreMouseEvents(!on, { forward: true });
    clearInterval(hoverPoll); hoverPoll = null;
    if (on && !process.env.LOUPE_NOPOLL) hoverPoll = setInterval(() => { // LOUPE_NOPOLL: dev snaps with a synthetic hover
      const p = screen.getCursorScreenPoint(), b = win.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) win.webContents.send('leave');
    }, 300);
  });
  // open a Code tab session in the Claude app. Terminal sessions have no app id, so nothing happens.
  ipcMain.on('open', (_, id) => {
    const s = sessions.get(id);
    if (s && /^local_[\w-]+$/.test(s.host)) shell.openExternal(`claude://claude.ai/epitaxy/${s.host}`);
  });
  // Windows: the foreground window's program, once a second. Mac: the menu bar helper reports it (setFront above).
  if (!MAC) try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll');
    const fg = user32.func('intptr_t __stdcall GetForegroundWindow()');
    const pidOf = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)');
    const open = kernel32.func('intptr_t __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
    const close = kernel32.func('bool __stdcall CloseHandle(intptr_t h)');
    const image = kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)');
    const exe = () => {
      const pid = [0]; pidOf(fg(), pid);
      const h = open(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid[0]);
      if (!h) return '';
      try { const buf = new Uint16Array(1024), size = [1024]; return image(h, 0, buf, size) ? String.fromCharCode(...buf.subarray(0, size[0])) : ''; }
      finally { close(h); }
    };
    setInterval(() => { try { setFront(/[\\/]claude\.exe$/i.test(exe())); } catch {} }, 1000);
  } catch (e) { console.log('foreground watch off', e.message); }

  ipcMain.on('answer', (_, { req, choice }) => {
    const p = pending.get(req);
    if (!p) return;
    pending.delete(req);
    if (process.env.LOUPE_SNAP) console.log('answer', new Date().toISOString(), p.ev.tool_name, JSON.stringify(choice));
    p.sock.end(JSON.stringify(reply(p.ev, choice)) + '\n');
    settle(sessions, req);
    push();
  });

  // Mac menu bar: a 16 pt template image (alpha only, macOS tints it); trayTemplate@2x.png loads with it
  const trayImg = nativeImage.createFromPath(path.join(__dirname, MAC ? 'trayTemplate.png' : 'icon.png'));
  if (MAC) trayImg.setTemplateImage(true);
  tray = new Tray(trayImg);
  tray.setToolTip('LOUPE');
  if (!MAC) tray.on('click', () => tray.popUpContextMenu()); // left click opens the menu too
  // quick settings live in the tray menu, saved to userData/config.json
  const cfgPath = path.join(app.getPath('userData'), 'config.json');
  const cfg = store.load(cfgPath, { closeDelay: 5000, sound: true, volume: 0.7, goo: true });
  // first run of the installed app: ask once whether to start with Windows (EXIT-2); the tray checkbox owns it after
  if (app.isPackaged && !cfg.loginSet) {
    dialog.showMessageBox({ title: 'LOUPE', noLink: true, defaultId: 0, cancelId: 1,
      message: MAC ? 'Open LOUPE when you log in?' : 'Start LOUPE with Windows?',
      detail: `You can change this later in the tray (${MAC ? 'Open at Login' : 'Start with Windows'}).`,
      buttons: [MAC ? 'Open at Login' : 'Start with Windows', 'Not now'],
    }).then(({ response }) => {
      app.setLoginItemSettings({ openAtLogin: response === 0 });
      cfg.loginSet = true; saveCfg(); menu();
    });
  }
  // where: 'top' = top of the main display, 'above' = bottom edge of the display stacked above it (falls back to 'top')
  const place = () => {
    const p = screen.getPrimaryDisplay().bounds;
    const up = !MAC && cfg.where === 'above' && screen.getAllDisplays().map(x => x.bounds)
      .find(b => b.y + b.height === p.y && b.x < p.x + p.width && b.x + b.width > p.x);
    const d = up || p;
    // cfg.dx: where the island was dragged to, from the centre (#10). Clamped so the open panel stays on screen.
    const lim = d.width / 2 - 230, dx = MAC ? 0 : Math.max(-lim, Math.min(lim, cfg.dx || 0));
    win.setBounds({ x: Math.round(d.x + (d.width - W) / 2 + dx), y: up ? d.y + d.height - H : d.y, width: W, height: H });
    return !!up;
  };
  screen.on('display-added', () => { place(); sendCfg(); });
  screen.on('display-removed', () => { place(); sendCfg(); });
  screen.on('display-metrics-changed', () => { place(); sendCfg(); });
  const sendCfg = () => {
    if (!MAC) win.webContents.setZoomFactor(cfg.size === 'small' ? 0.85 : 1); // tray Size (#10); the notch keeps its fit
    win.webContents.send('config', { ...cfg, dock: place(), procsOk: !MAC });
  };
  const saveCfg = () => store.save(cfgPath, cfg);
  // Windows: drag the island sideways along its edge (#10). dx is the cursor travel since the press.
  let dragFrom = 0;
  ipcMain.on('drag', (_, { phase, dx }) => {
    if (MAC) return;
    if (phase === 'start') dragFrom = cfg.dx || 0;
    cfg.dx = dragFrom + dx * win.webContents.getZoomFactor(); place(); // dx is in CSS px
    if (phase === 'end') saveCfg();
  });
  // Other on a question card: take the keyboard while typing, then give it back
  ipcMain.on('focus', (_, on) => { if (win.isDestroyed()) return; win.setFocusable(on); if (on) win.focus(); });
  win.webContents.on('did-finish-load', sendCfg);
  // Mac: after sleep the panel can stop drawing while events still arrive. Reload it on wake, on unlock and if
  // its renderer dies; the sessions live here in main, so nothing is lost.
  if (MAC) {
    win.webContents.on('did-finish-load', push); // a reload starts with an empty list: refill it
    const reload = why => setTimeout(() => {
      if (win.isDestroyed()) return;
      if (process.env.LOUPE_SNAP) console.log('reload', new Date().toISOString(), why);
      win.webContents.reload();
    }, 1500);
    win.webContents.on('render-process-gone', (_, d) => reload(`renderer ${d.reason}`));
    powerMonitor.on('resume', () => reload('resume'));
    powerMonitor.on('unlock-screen', () => reload('unlock'));
  }
  const menu = () => tray.setContextMenu(Menu.buildFromTemplate([
    ...(MAC ? [] : [{ label: 'Where', submenu: [['top', 'Top of main screen'], ['above', 'Bottom of the screen above']].map(([v, label]) => ({
      label, type: 'radio', checked: (cfg.where || 'top') === v,
      click: () => { cfg.where = v; saveCfg(); sendCfg(); menu(); },
    })) }]),
    { label: 'Glass', submenu: [['clear', 'Clear'], ['dark', 'Dark'], ['solid', 'Solid']].map(([v, label]) => ({
      label, type: 'radio', checked: (cfg.glass || 'dark') === v, click: () => { cfg.glass = v; saveCfg(); sendCfg(); menu(); },
    })) },
    ...(MAC ? [] : [{ label: 'Size', submenu: [['small', 'Small'], ['normal', 'Normal']].map(([v, label]) => ({
      label, type: 'radio', checked: (cfg.size || 'normal') === v, click: () => { cfg.size = v; saveCfg(); sendCfg(); menu(); },
    })) }]),
    ...(MAC ? [] : [{ label: 'Reset position', enabled: !!cfg.dx, click: () => { cfg.dx = 0; saveCfg(); place(); menu(); } }]),
    { label: 'Close after hover', submenu: [0, 150, 300, 600, 1000, 2000, 5000].map(ms => ({
      label: ms ? `${ms / 1000} s` : 'Instant', type: 'radio', checked: cfg.closeDelay === ms,
      click: () => { cfg.closeDelay = ms; saveCfg(); sendCfg(); menu(); },
    })) },
    { label: 'Gooey motion', type: 'checkbox', checked: cfg.goo,
      click: () => { cfg.goo = !cfg.goo; saveCfg(); sendCfg(); menu(); } },
    ...(MAC ? [] : [{ label: 'Processes (leftovers from sessions)', type: 'checkbox', checked: !!cfg.procs,
      click: () => { cfg.procs = !cfg.procs; cfg.procsAsked = true; saveCfg(); sendCfg(); menu(); procsTick(true); } }]),
    { label: 'Sounds', type: 'checkbox', checked: cfg.sound,
      click: () => { cfg.sound = !cfg.sound; saveCfg(); sendCfg(); menu(); } },
    // relay.js reads these: on, they wait for the island and stay out of the thread until answered or Claude comes to front
    { label: 'Answer questions on LOUPE (hides them from the thread until answered)', type: 'checkbox', checked: !!cfg.answerQuestions,
      click: () => { cfg.answerQuestions = !cfg.answerQuestions; saveCfg(); menu(); } },
    { label: 'Answer permissions on LOUPE (hides them from the thread until answered)', type: 'checkbox', checked: !!cfg.answerOnIsland,
      click: () => { cfg.answerOnIsland = !cfg.answerOnIsland; saveCfg(); menu(); } },
    // installed app only: in dev this would register electron.exe itself
    ...(app.isPackaged ? [{ label: MAC ? 'Open at Login' : 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); menu(); } }] : []),
    { type: 'separator' },
    ...(MAC && axTrusted === false ? [{ label: 'Allow Accessibility for the menu bar slide…', click: () => {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      say('Accessibility for LOUPE', 'If LOUPE is already on in the list, select it, remove it with −, then add it back with + from Applications. Each new build needs this once.');
    } }] : []),
    { label: 'Check Claude Code hooks', click: () => hookCheck() },
    ready ? { label: `Restart to update to ${ready}`, click: () => install() }
      : { label: `Check for updates (${app.getVersion()})`, enabled: app.isPackaged, click: () => checkUpdates(true) },
    { label: 'Quit LOUPE', click: () => app.quit() },
  ]));
  // updates: GitHub releases (package.json build.publish). Windows downloads in the background, then asks before it
  // installs (#1): "Restart to update" in a prompt once a day per version, and in the tray. Nothing installs on quit:
  // LOUPE rarely quits on its own (Windows ends it at shutdown), which is how 0.2.14 sat on a downloaded 0.3.0 (#17).
  // The Mac build is unsigned, which Squirrel.Mac refuses, so there it only points at the release.
  let ready = null, manual = false, told = '', checkUpdates = () => {}, install = () => {};
  const say = (message, detail = '') => dialog.showMessageBox({ title: 'LOUPE', message, detail, noLink: true });
  // a failing updater must never stop the island: everything after this (tray menu, pipe) still runs
  if (app.isPackaged) try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = !MAC;
    autoUpdater.autoInstallOnAppQuit = false;
    install = () => autoUpdater.quitAndInstall(true, true); // silent, and LOUPE starts again after
    // userData/updater.log, so a missed update can be traced (#17). Starts over past 256 KB.
    const ulog = path.join(app.getPath('userData'), 'updater.log');
    store.capLog(ulog, 256 << 10);
    const w = lvl => m => fs.appendFile(ulog, `${new Date().toISOString()} ${lvl} ${m}\n`, () => {});
    autoUpdater.logger = { info: w('info'), warn: w('warn'), error: w('error'), debug() {} };
    require('./update-signature').guard(autoUpdater, { app: 'LOUPE', log: autoUpdater.logger.warn,
      sigUrl: v => `https://github.com/gigolajulian/loupe/releases/download/v${v}/LOUPE-Setup-${v}.exe.sig` });
    autoUpdater.on('update-available', i => {
      if (!MAC) return manual && say(`Downloading LOUPE ${i.version}`, 'LOUPE asks before it installs.');
      if (!manual && told === i.version) return;
      told = i.version;
      dialog.showMessageBox({ title: 'LOUPE', message: `LOUPE ${i.version} is out`, buttons: ['Download', 'Later'], noLink: true })
        .then(({ response }) => response === 0 && shell.openExternal('https://github.com/gigolajulian/loupe/releases/latest')); // the packaged package.json has no build.publish
    });
    autoUpdater.on('update-not-available', () => manual && say(`LOUPE ${app.getVersion()} is up to date`));
    // every check re-emits this for a download already on disk: ask at most once a day per version, unless asked
    const askedAt = {};
    autoUpdater.on('update-downloaded', i => {
      ready = i.version; menu();
      if (!manual && Date.now() - (askedAt[i.version] || 0) < 24 * 3600e3) return;
      askedAt[i.version] = Date.now();
      const notes = (Array.isArray(i.releaseNotes) ? i.releaseNotes.map(n => n.note).join('\n') : String(i.releaseNotes || ''))
        .replace(/<\/(p|li|h\d)>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
      dialog.showMessageBox({ title: 'LOUPE', message: `LOUPE ${i.version} is ready`, noLink: true,
        detail: `${notes ? notes + '\n\n' : ''}Restart LOUPE to update, now or later from the tray.`,
        buttons: ['Restart to update', 'Later'], defaultId: 0, cancelId: 1,
      }).then(({ response }) => response === 0 && install());
    });
    autoUpdater.on('error', e => { if (manual) say('Update check failed', String(e.message || e).split('\n')[0]); manual = false; });
    checkUpdates = m => { manual = m; autoUpdater.checkForUpdates().catch(() => {}); };
    checkUpdates(false);
    setInterval(() => checkUpdates(false), 4 * 3600e3);
    powerMonitor.on('resume', () => checkUpdates(false)); // a PC that sleeps more than it runs still hears of updates
  } catch (e) { console.log('updater failed', e); }
  menu();
  // first run or broken hooks: show the check with its Fix button, so setup never fails silently
  if (/--(fix|check)-hooks/.test(process.argv.join(' '))) hookArgs(process.argv); else hookCheck(false, true);
  // the island's own sound controls, and the Processes switch
  ipcMain.on('config', (_, p) => { const patch = ipc.cfgPatch(p); Object.assign(cfg, patch); saveCfg(); menu(); if ('procs' in patch) { sendCfg(); procsTick(); } });

  // Processes (Windows): what Claude sessions left running. reap.ps1 finds them; LOUPE only shows and asks.
  // Off until turned on. Polls every 2 min while on, and when the panel opens (at most every 10 s).
  // PowerShell can't read inside the asar. LOUPE_REAP (dev, scripts/exit-check.js): a stand-in scan
  const REAP = process.env.LOUPE_REAP || path.join(__dirname, 'reap', 'reap.ps1').replace('app.asar', 'app.asar.unpacked');
  const userAllow = path.join(os.homedir(), '.claude', 'skills', 'reap', 'allow.txt');
  // reap.ps1 appends to ~/.claude/reap.log: keep it small. A scan still running ends with LOUPE: Node puts every child
  // in a kill-on-close job object, as long as it is not started detached (EXIT-1, scripts/exit-check.js).
  store.capLog(path.join(os.homedir(), '.claude', 'reap.log'), 256 << 10);
  const reap = (args, done) => require('child_process').execFile('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', REAP, '-Json',
      '-AllowFile', fs.existsSync(userAllow) ? userAllow : path.join(path.dirname(REAP), 'allow.txt'), ...args],
    { windowsHide: true, timeout: 30e3, maxBuffer: 4 << 20 }, (err, out) => { let j = null; try { j = JSON.parse(out); } catch {} done(err, j); });
  let procsAt = 0, procsBusy = false, procsTimer = null;
  const sendProcs = j => {
    if (win.isDestroyed()) return;
    if (!j) return win.webContents.send('procs', null);
    const byPid = new Map([...sessions.values()].filter(s => s.pid).map(s => [s.pid, s.id]));
    const rows = (j.sessions || []).map(r => ({ ...r, sid: byPid.get(r.Host) || '' }));
    win.webContents.send('procs', { leftovers: j.leftovers || [], sessions: rows });
  };
  function procsTick(force) {
    clearTimeout(procsTimer); procsTimer = null;
    procsOn = !MAC && !!cfg.procs;
    if (!procsOn) return sendProcs(null);
    procsTimer = setTimeout(() => procsTick(true), 120e3);
    if (procsBusy || (!force && Date.now() - procsAt < 10e3) || (force && away())) return; // away: nobody to show it to
    procsBusy = true;
    reap([], (err, j) => { procsBusy = false; procsAt = Date.now(); if (j) sendProcs(j); else console.log('reap failed', err && err.message); });
  }
  ipcMain.on('procs', () => procsTick(false)); // the panel opened
  // Kill picked rows. reap re-checks each PID's start time and command first, and logs to ~/.claude/reap.log.
  ipcMain.handle('kill', (_, pids) => new Promise(res => {
    // "pid@start": reap kills only if the PID still has the start time the panel showed (no reused PIDs)
    pids = ipc.killList(pids);
    if (MAC || !cfg.procs || !pids.length) return res([]);
    reap(['-Kill', pids.join(',')], (err, out) => { res(Array.isArray(out) ? out : [String(out || (err && err.message) || 'failed')]); procsTick(true); });
  }));
  win.webContents.on('did-finish-load', () => procsTick(true));

  listen();
  setInterval(push, 1000); // done -> idle fade, stale drop
  setInterval(releaseIfAway, 5000);

  // dev: LOUPE_SNAP=out.png writes what the window draws every second
  if (process.env.LOUPE_SNAP) {
    console.log('win', JSON.stringify(win.getBounds()), 'display', JSON.stringify(screen.getPrimaryDisplay().bounds),
      'workArea', JSON.stringify(screen.getPrimaryDisplay().workArea), 'notch', JSON.stringify(n));
    win.webContents.on('console-message', e => console.log('renderer:', e.message));
    win.webContents.on('preload-error', (_, p, err) => console.log('preload error', err));
    setInterval(() => win.webContents.capturePage().then(i => require('fs').writeFileSync(process.env.LOUPE_SNAP, i.toPNG())), 1000);
    // dev: LOUPE_CLICK=file. Each line of the file is a button label to click on the ask card, one per second.
    if (process.env.LOUPE_CLICK) setInterval(() => {
      const fs = require('fs');
      let lines = [];
      try { lines = fs.readFileSync(process.env.LOUPE_CLICK, 'utf8').split('\n').filter(Boolean); } catch {}
      if (!lines.length) return;
      fs.writeFileSync(process.env.LOUPE_CLICK, lines.slice(1).join('\n'));
      const l = lines[0].trim();
      if (l.startsWith('burst:')) { // burst:<name>|<js> runs js, then grabs 14 frames 40 ms apart
        const [name, js] = l.slice(6).split('|');
        if (js) win.webContents.executeJavaScript(js);
        for (let i = 0; i < 14; i++) setTimeout(() => win.webContents.capturePage().then(img =>
          fs.writeFileSync(process.env.LOUPE_SNAP.replace(/\.png$/, `-${name}-${String(i).padStart(2, '0')}.png`), img.toPNG())), i * 40);
        return;
      }
      if (l.startsWith('js:')) return win.webContents.executeJavaScript(l.slice(3)).then(r => console.log('js:', JSON.stringify(r)));
      win.webContents.executeJavaScript(`[...document.querySelectorAll('#card button')].find(b => b.textContent.trim() === ${JSON.stringify(l)})?.click()`);
    }, 1000);
  }
});
