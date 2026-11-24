// Where LOUPE listens for hook events. A fixed, guessable name let any local program take it first and then read
// every hook, or answer permission prompts (LOC-1). So: Windows gets a random pipe name per launch, the Mac a socket
// inside ~/.loupe, and the address goes into ~/.loupe/pipe, which only this account can read. relay.js reads it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function open(dir, mac = process.platform === 'darwin') {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (mac) fs.chmodSync(dir, 0o700); // the folder may predate this version
  const addr = mac ? path.join(dir, 'loupe.sock') : `\\\\.\\pipe\\loupe-${crypto.randomBytes(16).toString('hex')}`;
  const file = path.join(dir, 'pipe'), tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, addr, { mode: 0o600 });
  fs.renameSync(tmp, file); // a relay never reads half a name
  return addr;
}

// one hook event per line. A line past max chars drops the connection: a stuck or hostile writer can't grow the buffer.
const MAX_LINE = 16 << 20; // a Write of a few MB still fits; a bigger event just isn't shown
function lines(sock, onLine, max = MAX_LINE) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', c => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onLine(l); }
    if (buf.length > max) { buf = ''; sock.destroy(); }
  });
}

module.exports = { open, lines, MAX_LINE };
