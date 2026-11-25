const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const S = require('../update-signature');

const APP = 'LOUPE';

test('electron-updater still runs verifySignature on every download before it installs', () => {
  const dir = path.dirname(require.resolve('electron-updater'));
  assert.match(fs.readFileSync(path.join(dir, 'NsisUpdater.js'), 'utf8'), /await this\.verifySignature\(destinationFile\)/);
});

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sign = (text) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64');

test('signature: only the release key, this app, this version and file', () => {
  const s = sign(`${APP} 1.2.3 ${'a'.repeat(64)}\n`);
  assert.ok(S.signed(APP, '1.2.3', 'a'.repeat(64), s, pub));
  assert.ok(!S.signed(APP, '1.2.4', 'a'.repeat(64), s, pub)); // an old installer re-posted as a newer version
  assert.ok(!S.signed('Other', '1.2.3', 'a'.repeat(64), s, pub)); // another app's installer
  assert.ok(!S.signed(APP, '1.2.3', 'b'.repeat(64), s, pub));
  assert.ok(!S.signed(APP, '1.2.3', 'a'.repeat(64), s)); // a key other than the shipped one
  assert.ok(!S.signed(APP, '1.2.3', 'a'.repeat(64), 'garbage', pub));
});

test('guard: installs only a download with a valid signature', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')), 'setup.exe');
  const body = Buffer.from('installer bytes');
  fs.writeFileSync(file, body);
  const u = new EventEmitter(), logs = [], urls = [];
  S.guard(u, { app: APP, sigUrl: (v) => `https://example.test/${v}.sig`, log: (m) => logs.push(m), key: pub });
  const real = global.fetch;
  const answer = (r) => { global.fetch = async (url) => { urls.push(url); return r; }; };
  try {
    assert.ok(await u.verifySignature(file)); // nothing announced yet
    u.emit('update-available', { version: '2.0.0' });
    answer({ ok: true, text: async () => sign(`${APP} 2.0.0 ${sha(body)}\n`) });
    assert.strictEqual(await u.verifySignature(file), null);
    assert.strictEqual(urls.at(-1), 'https://example.test/2.0.0.sig');
    answer({ ok: true, text: async () => sign(`${APP} 1.0.0 ${sha(body)}\n`) });
    assert.match(await u.verifySignature(file), /does not match/);
    answer({ ok: false, status: 404 });
    assert.match(await u.verifySignature(file), /no signature/);
    global.fetch = async () => { throw new Error('offline'); };
    assert.match(await u.verifySignature(file), /offline/);
    assert.ok(logs.length >= 4 && logs.every((m) => /not installing/.test(m)));
  } finally { global.fetch = real; fs.rmSync(path.dirname(file), { recursive: true }); }
});

// SEC-9: only a signature from a trusted key, over this exact app, version and sha, is accepted.
test('signatures: Hello RSA and recovery ed25519 pass, forged or wrong-key ones are refused', () => {
  const spki = (k) => k.export({ type: 'spki', format: 'der' }).toString('base64');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), ed = crypto.generateKeyPairSync('ed25519');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = [spki(rsa.publicKey), spki(ed.publicKey)], h = 'a'.repeat(64);
  const text = Buffer.from(`${APP} 9.0.0 ${h}\n`);
  const byRsa = crypto.sign('sha256', text, rsa.privateKey).toString('base64'); // what Windows Hello makes
  const byEd = crypto.sign(null, text, ed.privateKey).toString('base64');
  assert.ok(S.signed(APP, '9.0.0', h, byRsa, keys));
  assert.ok(S.signed(APP, '9.0.0', h, byEd + '\n', keys));
  assert.ok(!S.signed(APP, '9.0.0', h, crypto.sign('sha256', text, other.privateKey).toString('base64'), keys), 'wrong key');
  assert.ok(!S.signed(APP, '9.0.0', h, Buffer.alloc(256, 7).toString('base64'), keys), 'forged');
  assert.ok(!S.signed(APP, '9.0.1', h, byRsa, keys), 'other version');
  assert.ok(!S.signed(APP, '9.0.0', 'b'.repeat(64), byEd, keys), 'other installer');
  assert.ok(!S.signed(APP, '9.0.0', h, byEd, [keys[0]]) && !S.signed(APP, '9.0.0', h, byRsa, [keys[1]]), 'a sig only checks against its own key type');
  assert.ok(!S.signed(APP, '9.0.0', h, '', keys) && !S.signed(APP, '9.0.0', h, byRsa, []));
});

test('the shipped keys are the Hello RSA key and the ed25519 recovery key', () => {
  const k = (b) => crypto.createPublicKey({ key: Buffer.from(b, 'base64'), format: 'der', type: 'spki' });
  assert.strictEqual(k(S.RECOVERY).asymmetricKeyType, 'ed25519');
  assert.ok(S.HELLO, 'HELLO is empty: paste the public key from `scripts/hello-sign.ps1 pubkey`');
  assert.strictEqual(k(S.HELLO).asymmetricKeyType, 'rsa');
});
