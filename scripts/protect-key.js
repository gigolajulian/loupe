// One-time: writes a passphrase-protected copy of the update signing key (SEC-9), next to the plain one.
//   node scripts/protect-key.js      (in a terminal; asks for the passphrase twice, nothing is shown or printed)
// It never changes or removes the plain key: other apps (CREEKY, LEADS DESKTOP, KelvinRGB) still sign with it until
// their release scripts read the protected copy. Then move the plain file into your offline backup.
const crypto = require('crypto');
const fs = require('fs');
const { ask, PLAIN, PROTECTED } = require('./release-key');
const { PUBKEY } = require('../update-signature');

(async () => {
  if (fs.existsSync(PROTECTED)) throw new Error(`${PROTECTED} already exists; nothing changed`);
  const key = crypto.createPrivateKey(fs.readFileSync(PLAIN));
  const pass = await ask('New passphrase (12+ characters): ');
  if (pass.length < 12) throw new Error('too short; nothing written');
  if (await ask('Same passphrase again: ') !== pass) throw new Error('they differ; nothing written');
  const pem = key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass });
  // the copy opens with the passphrase and is the key installs trust
  const back = crypto.createPrivateKey({ key: pem, passphrase: pass });
  if (crypto.createPublicKey(back).export({ type: 'spki', format: 'der' }).toString('base64') !== PUBKEY) throw new Error('the key does not match update-signature.js; nothing written');
  fs.writeFileSync(PROTECTED, pem, { mode: 0o600, flag: 'wx' });
  console.log(`wrote ${PROTECTED}. LOUPE releases now ask for this passphrase.`);
})().catch(e => { console.error(e.message); process.exit(1); });
