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

module.exports = { open };
