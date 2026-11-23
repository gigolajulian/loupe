// Signs the Windows installer so installed copies accept it as an update. Runs after electron-builder in `npm run release`;
// alone: `node scripts/sign-release.js` writes the .sig, `--upload` also adds it to release v<version>.
// Key: RELEASE_SIGNING_KEY (a file path) or ~/.release-keys/updates-ed25519.pem. Never in a repo, never printed.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { version } = require('../package.json');
const { signed } = require('../update-signature');

const APP = 'LOUPE', REPO = 'gigolajulian/loupe';
// electron-builder writes "LOUPE Setup x.exe" locally and uploads it as "LOUPE-Setup-x.exe"; the .sig takes the uploaded name.
const file = path.join(__dirname, '..', 'dist', `LOUPE Setup ${version}.exe`);
const out = path.join(__dirname, '..', 'dist', `LOUPE-Setup-${version}.exe.sig`);
const tag = process.argv.includes('--upload') && `v${version}`;
const keyFile = process.env.RELEASE_SIGNING_KEY || path.join(os.homedir(), '.release-keys', 'updates-ed25519.pem');

const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sig = crypto.sign(null, Buffer.from(`${APP} ${version} ${sha}\n`), fs.readFileSync(keyFile)).toString('base64');
if (!signed(APP, version, sha, sig)) throw new Error('this key does not match the public key in update-signature.js');
fs.writeFileSync(out, sig + '\n');
console.log(`signed ${path.basename(file)}`);
if (tag) execFileSync('gh', ['release', 'upload', tag, out, '--clobber', '-R', REPO], { stdio: 'inherit' });
