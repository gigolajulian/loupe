// Signs the Windows installer so installed copies accept it as an update. Runs after electron-builder in `npm run release`;
// alone: `node scripts/sign-release.js` writes the .sig, `--upload` also adds it to release v<version>.
// Key: scripts/release-key.js (RELEASE_SIGNING_KEY, else ~/.release-keys/updates-ed25519.enc.pem; passphrase-protected
// only). Never in a repo, never printed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { version } = require('../package.json');
const { signed } = require('../update-signature');
const { loadKey, helloSign } = require('./release-key'); // Hello by default, --recovery for the ed25519 key

const APP = 'LOUPE', REPO = 'gigolajulian/loupe';
// electron-builder writes "LOUPE Setup x.exe" locally and uploads it as "LOUPE-Setup-x.exe"; the .sig takes the uploaded name.
const file = path.join(__dirname, '..', 'dist', `LOUPE Setup ${version}.exe`);
const out = path.join(__dirname, '..', 'dist', `LOUPE-Setup-${version}.exe.sig`);
const tag = process.argv.includes('--upload') && `v${version}`;

(async () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const text = `${APP} ${version} ${sha}\n`;
  const sig = (process.argv.includes('--recovery') || process.env.RELEASE_RECOVERY === '1') ? crypto.sign(null, Buffer.from(text), await loadKey()).toString('base64') : helloSign(text);
  if (!signed(APP, version, sha, sig)) throw new Error('this key does not match a public key in update-signature.js');
  fs.writeFileSync(out, sig + '\n');
  console.log(`signed ${path.basename(file)}`);
  if (tag) execFileSync('gh', ['release', 'upload', tag, out, '--clobber', '-R', REPO], { stdio: 'inherit' });
})().catch(e => { console.error(e.message); process.exit(1); });
