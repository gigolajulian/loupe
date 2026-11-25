// Updates install only if they carry a valid signature from one of the release keys.
// The checksum in latest.yml sits next to the installer, so whoever can upload one can upload the other. The private
// halves of these keys live only on Julian's PC and never touches the release host, so a stolen account can't sign.
// Signed text: "<app> <version> <sha256>\n", so an old signed installer can't be re-posted as a newer version.
const crypto = require('crypto');
const fs = require('fs');

// HELLO: the everyday key, RSA-2048 held by Windows Hello in the PC's TPM (can't be copied off it, a fingerprint or
// PIN per signature). RECOVERY: the passphrase-locked ed25519 key, kept for when the Hello key is lost (README).
const HELLO = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0dmGaWMVQXr9tv3WVxpRHWO9fpOsQz7jCVrJJk6/j2VmPAaNhwWr8ml+Q/C6J+OaanYafbo2xN2OcgLCCtjLl5Hjj9WGswcPClquHxMkE40XQ+dhMKV+ZGODa9e0Nrc3sagxonxfottRETPo2oMmW7aMZIA3Zs/0b/iI7u1dpI2/aTXgx7OE815n1lZ2rQ3JXeU+tGceI/S5LfEcENnyKbHe5ZG62u2iH6kqtqes1AMz1fhGzwtUv/n0k8uFoI37QRv0xDxf28oJVJI3qdXjDJM3IT+1k8272CYZpwNpIsPhOLnYR6LpbnihNtAh24I2olntZZSYJxT7DVhHOcR9twIDAQAB';
const RECOVERY = 'MCowBQYDK2VwAyEA8gcyEU9pjNP2Vp6fuBZe3IQmxU4Wdn8V2VxFNjuh0CQ=';
const KEYS = [HELLO, RECOVERY];
// the algorithm comes from the trusted key, never from the .sig file
const ALG = { ed25519: null, rsa: 'sha256' };

function signed(app, v, sha, sig, keys = KEYS) {
  const text = Buffer.from(`${app} ${v} ${sha}\n`), s = Buffer.from(String(sig).trim(), 'base64');
  return [].concat(keys).some((key) => {
    try {
      const k = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
      return k.asymmetricKeyType in ALG && crypto.verify(ALG[k.asymmetricKeyType], text, k, s);
    } catch { return false; }
  });
}

// electron-updater (NsisUpdater) awaits verifySignature(file) on every fresh download, before it emits
// update-downloaded or can install; any non-null answer deletes the file and fails the update. Without a
// code-signing certificate its own check is skipped, so ours takes its place. test/update-signature.test.js
// fails if an electron-updater bump stops calling it.
// the installer is hashed as a stream (it is ~100 MB), and the signature fetch gives up after timeoutMs: a stalled
// server fails the update, which the next check (every 4 h) retries
const sha256 = file => new Promise((res, rej) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('error', rej).on('data', c => h.update(c)).on('end', () => res(h.digest('hex')));
});

function guard(updater, { app, sigUrl, log = console.error, key, timeoutMs = 30e3 }) {
  let info = null;
  updater.on('update-available', (i) => { info = i; });
  updater.verifySignature = async (file) => {
    let why = 'no update info';
    try {
      if (info) {
        const sha = await sha256(file);
        const r = await fetch(sigUrl(info.version), { signal: AbortSignal.timeout(timeoutMs) });
        why = !r.ok ? `no signature (${r.status})` : signed(app, info.version, sha, await r.text(), key) ? '' : 'signature does not match';
      }
    } catch (e) { why = e.message; }
    if (!why) return null;
    log(`update ${info && info.version}: ${why}, not installing`);
    return why;
  };
}

module.exports = { signed, guard, HELLO, RECOVERY };
