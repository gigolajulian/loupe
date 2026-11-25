// Uninstall cleanup (EXIT-2), run by the uninstaller as `LOUPE.exe --uninstall` (build/installer.nsh) before files go.
// Takes LOUPE's own hooks out of ~/.claude/settings.json (backup first, other hooks stay) and removes ~/.loupe.
// The installer itself removes the login item and %APPDATA%\LOUPE. Pure Node, no Electron.
const fs = require('fs');
const path = require('path');
const hooks = require('./hooks');
const store = require('./store');

function cleanup(home, now = new Date()) {
  const done = [];
  const file = path.join(home, '.claude', 'settings.json');
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  if (text !== null) {
    let settings = null;
    try { settings = JSON.parse(text); } catch {} // unreadable: leave it alone rather than guess
    const out = settings && hooks.remove(settings);
    if (out && JSON.stringify(out.hooks) !== JSON.stringify(settings.hooks || {})) { // only when LOUPE had hooks there
      const bak = `${file}.bak-loupe-${now.toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(file, bak);
      if (store.save(file, JSON.stringify(out, null, 2) + '\n')) done.push(`hooks removed, backup ${path.basename(bak)}`);
    }
  }
  const dir = path.join(home, '.loupe');
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); done.push('~/.loupe removed'); }
  return done;
}

module.exports = { cleanup };
