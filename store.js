// LOUPE's files on disk: settings that survive a crash, and logs and backups that stay small. Pure Node, no Electron.
const fs = require('fs');
const path = require('path');

// settings: whatever was saved, over the defaults. A missing or broken file, or one from an older LOUPE without the
// newer keys, still opens (DATA-3). No schema version: the file is a flat bag of tray settings.
function load(file, defaults) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...defaults, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
  } catch { return { ...defaults }; }
}

// temp file, then rename: a crash or a full disk mid-write leaves the old file whole. false = not saved, no throw.
function save(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

// a log past max bytes keeps its newest half (whole lines)
function capLog(file, max) {
  try {
    const size = fs.statSync(file).size;
    if (size <= max) return;
    const keep = fs.readFileSync(file).subarray(size - Math.floor(max / 2)).toString('utf8');
    save(file, keep.slice(keep.indexOf('\n') + 1));
  } catch {}
}

// keep the newest `keep` files in dir whose names start with prefix (ISO-stamped names sort by time)
function prune(dir, prefix, keep) {
  try {
    const old = fs.readdirSync(dir).filter(f => f.startsWith(prefix)).sort().slice(0, -keep || undefined);
    for (const f of old) try { fs.unlinkSync(path.join(dir, f)); } catch {}
  } catch {}
}

// a crash or error line to a capped local log, so a failure can be traced later (DATA-2). Never throws.
function logger(file, max = 256 << 10) {
  return (what, e) => {
    try {
      capLog(file, max);
      fs.appendFileSync(file, `${new Date().toISOString()} ${what} ${(e && (e.stack || e.message)) || e || ''}\n`);
    } catch {}
  };
}

module.exports = { load, save, capLog, prune, logger };
