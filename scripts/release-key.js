// The update signing key, passphrase-protected (SEC-9). Never printed, never in a repo.
// Which file: RELEASE_SIGNING_KEY (a path), else ~/.release-keys/updates-ed25519.enc.pem. Only a passphrase-protected key
// is used: a plain one is refused (protect it with scripts/protect-key.js). The passphrase is asked in the terminal, without echo.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.release-keys');
const PLAIN = path.join(DIR, 'updates-ed25519.pem'), PROTECTED = path.join(DIR, 'updates-ed25519.enc.pem');

// a line typed in the terminal, not shown
function ask(question) {
  const i = process.stdin;
  if (!i.isTTY) throw new Error('the signing key needs its passphrase: run this in a terminal (npm run release or node scripts/sign-release.js --upload)');
  return new Promise(res => {
    process.stdout.write(question);
    let s = '';
    i.setRawMode(true); i.resume();
    i.on('data', function on(b) {
      for (const c of b.toString('utf8')) {
        if (c === '\u0003') { i.setRawMode(false); process.exit(130); } // Ctrl+C
        if (c === '\r' || c === '\n') { i.setRawMode(false); i.pause(); i.removeListener('data', on); process.stdout.write('\n'); return res(s); }
        s = c === '\u007f' || c === '\b' ? s.slice(0, -1) : s + c;
      }
    });
  });
}

async function loadKey() {
  const file = process.env.RELEASE_SIGNING_KEY || PROTECTED;
  const pem = fs.readFileSync(file, 'utf8');
  if (!pem.includes('BEGIN ENCRYPTED PRIVATE KEY')) throw new Error(`${path.basename(file)} is not passphrase-protected: run node scripts/protect-key.js`);
  const passphrase = await ask(`Passphrase for ${path.basename(file)}: `);
  try { return crypto.createPrivateKey({ key: pem, passphrase }); }
  catch { throw new Error('wrong passphrase'); }
}

module.exports = { loadKey, ask, PLAIN, PROTECTED };
