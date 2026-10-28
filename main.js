const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, nativeTheme, shell, dialog } = require('electron');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { apply, view, settle, reply } = require('./sessions');
const hooks = require('./hooks');

const MAC = process.platform === 'darwin';
// a fixed /tmp path, not os.tmpdir(): $TMPDIR can differ between the app (launchd) and the hook processes
const PIPE = MAC ? `/tmp/loupe-${os.userInfo().username}.sock` : `\\\\.\\pipe\\loupe-${os.userInfo().username}`;
// hooks run the relay from here, not from inside the app, so every update reaches it
const RELAY = path.join(os.homedir(), '.loupe', 'relay.js');
const W = 760, H = 460;
const sessions = new Map();
const pending = new Map(); // req -> { sock, ev }: hooks waiting for an answer
let seq = 0, lastEvent = 0;
let win, tray;

if (!app.requestSingleInstanceLock()) process.exit(0);
// `LOUPE --check-hooks` opens the hook check, `--fix-hooks` fixes first (for install prompts); also in the running copy
const hookArgs = argv => { if (argv.includes('--fix-hooks')) hookCheck(true); else if (argv.includes('--check-hooks')) hookCheck(); };
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

function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', view(sessions));
}

// the session's title (the app's rename, e.g. "JG - QA") is the last agent-name line in its transcript
function readTitle(s, file) {
  s.title = s.title || '';
  fs.readFile(file, 'utf8', (err, text) => {
    if (err) return;
    const all = [...text.matchAll(/"type":"agent-name","agentName":"((?:[^"\\]|\\.)*)"/g)];
    if (!all.length) return;
    s.title = JSON.parse(`"${all[all.length - 1][1]}"`);
    push();
  });
}

function listen() {
  const server = net.createServer(sock => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        lastEvent = Date.now();
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
        if (s && ev.transcript_path && (s.title === undefined || ev.hook_event_name === 'UserPromptSubmit')) readTitle(s, ev.transcript_path);
      }
      push();
    });
    sock.on('error', () => {});
  });
  if (MAC) try { fs.unlinkSync(PIPE); } catch {} // stale socket from a crash; the single-instance lock means no live one
  server.listen(PIPE);
}

// tray "Check Claude Code hooks": node, the 10 relay hooks, leftovers, last event. Fix backs up settings.json first.
function hookCheck(autoFix) {
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
  (autoFix && fixable ? Promise.resolve({ response: 0 }) : dialog.showMessageBox({
    type: ok ? 'info' : 'warning', title: 'LOUPE', message: ok ? 'Claude Code hooks are set' : 'Claude Code hooks need a look',
    detail: lines.filter((l, i) => l || lines[i - 1]).join('\n') + (fixable ? '\n\nFix hooks backs up settings.json, removes old LOUPE and Coucou hooks and adds the 10 LOUPE hooks. Other hooks stay.' : ''),
    buttons: fixable ? ['Fix hooks', 'Close'] : ['Close'], defaultId: 0, cancelId: fixable ? 1 : 0, noLink: true,
  })).then(({ response }) => {
    if (!fixable || response !== 0) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-loupe-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.writeFileSync(file, JSON.stringify(hooks.fix(settings, RELAY), null, 2) + '\n');
    } catch (e) { return dialog.showMessageBox({ type: 'error', title: 'LOUPE', message: 'Fix failed', detail: e.message }); }
    hookCheck(); // show the result
  });
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' }, // cues play unclicked
  });
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
      vibrancy: 'hud', visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true, width: 100, height: 100,
      enableLargerThanScreen: true, // its top edge sits above the screen, so only the bottom corners show rounded
    });
    glass.setIgnoreMouseEvents(true);
    glass.setAlwaysOnTop(true, 'pop-up-menu'); // over the menu bar, so panel and bar read as one surface; LOUPE's own window stays above
    glass.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // tint: the menu bar's colour over this Mac's wallpaper (an Aerial, so there is no image to sample); LOUPE_TINT=r,g,b,a overrides
    const tint = process.env.LOUPE_TINT || '18,44,70,.72';
    glass.loadURL(`data:text/html,<style>html{background:rgba(${tint})}</style>`);
  }
  ipcMain.on('glass', (_, r) => {
    if (!glass) return;
    if (!r) return glass.hide();
    const o = win.getBounds();
    glass.setBounds({ x: Math.round(o.x + r.x), y: Math.round(o.y + r.y), width: Math.round(r.w), height: Math.round(r.h) });
    if (!glass.isVisible()) { glass.showInactive(); win.moveTop(); }
  });

  // island under the cursor takes clicks, the rest of the window passes them through
  ipcMain.on('hover', (_, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
  // open a Code tab session in the Claude app. Terminal sessions have no app id, so nothing happens.
  ipcMain.on('open', (_, id) => {
    const s = sessions.get(id);
    if (s && /^local_[\w-]+$/.test(s.host)) shell.openExternal(`claude://claude.ai/epitaxy/${s.host}`);
  });
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
  let cfg = { closeDelay: 5000, sound: true, volume: 0.7, goo: true };
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); } catch {}
  // first run of the installed app: start with Windows, once; the tray checkbox owns it after that
  if (app.isPackaged && !cfg.loginSet) {
    app.setLoginItemSettings({ openAtLogin: true });
    cfg.loginSet = true; fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  }
  const sendCfg = () => win.webContents.send('config', cfg);
  win.webContents.on('did-finish-load', sendCfg);
  const menu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Close after hover', submenu: [0, 150, 300, 600, 1000, 2000, 5000].map(ms => ({
      label: ms ? `${ms / 1000} s` : 'Instant', type: 'radio', checked: cfg.closeDelay === ms,
      click: () => { cfg.closeDelay = ms; fs.writeFileSync(cfgPath, JSON.stringify(cfg)); sendCfg(); menu(); },
    })) },
    { label: 'Gooey motion', type: 'checkbox', checked: cfg.goo,
      click: () => { cfg.goo = !cfg.goo; fs.writeFileSync(cfgPath, JSON.stringify(cfg)); sendCfg(); menu(); } },
    { label: 'Sounds', type: 'checkbox', checked: cfg.sound,
      click: () => { cfg.sound = !cfg.sound; fs.writeFileSync(cfgPath, JSON.stringify(cfg)); sendCfg(); menu(); } },
    // relay.js reads this: on, permissions and questions wait for the island and stay out of the thread until answered
    { label: 'Answer prompts on LOUPE (hides them from the thread until answered)', type: 'checkbox', checked: !!cfg.answerOnIsland,
      click: () => { cfg.answerOnIsland = !cfg.answerOnIsland; fs.writeFileSync(cfgPath, JSON.stringify(cfg)); menu(); } },
    // installed app only: in dev this would register electron.exe itself
    ...(app.isPackaged ? [{ label: MAC ? 'Open at Login' : 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); menu(); } }] : []),
    { type: 'separator' },
    { label: 'Check Claude Code hooks', click: hookCheck },
    ready ? { label: `Restart to update to ${ready}`, click: () => require('electron-updater').autoUpdater.quitAndInstall() }
      : { label: `Check for updates (${app.getVersion()})`, enabled: app.isPackaged, click: () => checkUpdates(true) },
    { label: 'Quit LOUPE', click: () => app.quit() },
  ]));
  // updates: GitHub releases (package.json build.publish). Windows downloads in the background and installs on quit.
  // The Mac build is unsigned, which Squirrel.Mac refuses, so there it only points at the release.
  let ready = null, manual = false, told = '', checkUpdates = () => {};
  const say = (message, detail = '') => dialog.showMessageBox({ title: 'LOUPE', message, detail, noLink: true });
  // a failing updater must never stop the island: everything after this (tray menu, pipe) still runs
  if (app.isPackaged) try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = !MAC;
    autoUpdater.on('update-available', i => {
      if (!MAC) return manual && say(`Downloading LOUPE ${i.version}`, 'It installs when LOUPE quits.');
      if (!manual && told === i.version) return;
      told = i.version;
      dialog.showMessageBox({ title: 'LOUPE', message: `LOUPE ${i.version} is out`, buttons: ['Download', 'Later'], noLink: true })
        .then(({ response }) => response === 0 && shell.openExternal('https://github.com/gigolajulian/loupe/releases/latest')); // the packaged package.json has no build.publish
    });
    autoUpdater.on('update-not-available', () => manual && say(`LOUPE ${app.getVersion()} is up to date`));
    autoUpdater.on('update-downloaded', i => { ready = i.version; menu(); if (manual) say(`LOUPE ${i.version} is ready`, 'Restart from the tray, or it installs when LOUPE quits.'); });
    autoUpdater.on('error', e => { if (manual) say('Update check failed', String(e.message || e).split('\n')[0]); manual = false; });
    checkUpdates = m => { manual = m; autoUpdater.checkForUpdates().catch(() => {}); };
    checkUpdates(false);
    setInterval(() => checkUpdates(false), 4 * 3600e3);
  } catch (e) { console.log('updater failed', e); }
  menu();
  hookArgs(process.argv);
  // the island's own sound controls
  ipcMain.on('config', (_, patch) => { Object.assign(cfg, patch); fs.writeFileSync(cfgPath, JSON.stringify(cfg)); menu(); });

  listen();
  setInterval(push, 1000); // done -> idle fade, stale drop

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
