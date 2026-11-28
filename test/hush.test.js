// Hush add-on: release lookup, signature gate, version order (hush.js)
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { latest, fetchSigned, newer } = require('../hush');

const rel = { tag_name: 'v1.6.0', assets: ['hush-v1.6.0.exe', 'hush-v1.6.0.exe.sig', 'hush-v1.6.0.zip'].map(name => ({ name, browser_download_url: 'u/' + name })) };

test('latest picks the signed exe, refuses a release without one', async () => {
  assert.deepStrictEqual(await latest(async () => JSON.stringify(rel)), { v: '1.6.0', exe: 'u/hush-v1.6.0.exe', sig: 'u/hush-v1.6.0.exe.sig' });
  await assert.rejects(latest(async () => JSON.stringify({ ...rel, assets: rel.assets.slice(0, 1) })), /no signed exe/);
});

test('fetchSigned writes only an exe signed for its version', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const key = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const exe = Buffer.from('MZ fake hush'), sha = crypto.createHash('sha256').update(exe).digest('hex');
  const sign = v => crypto.sign(null, Buffer.from(`Hush ${v} ${sha}\n`), privateKey).toString('base64');
  const to = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hush-')), 'Hush.exe.new');
  const r = { v: '1.6.0', exe: 'e', sig: 's' };
  await fetchSigned(r, to, async u => (u === 'e' ? exe : sign('1.6.0')), key);
  assert.deepStrictEqual(fs.readFileSync(to), exe);
  fs.rmSync(to);
  await assert.rejects(fetchSigned(r, to, async u => (u === 'e' ? exe : sign('1.5.0')), key), /not signed/); // old sig re-posted
  await assert.rejects(fetchSigned(r, to, async u => (u === 'e' ? exe : sign('1.6.0'))), /not signed/); // not the release key
  assert.ok(!fs.existsSync(to));
});

test('newer compares versions as numbers', () => {
  assert.ok(newer('1.10.0', '1.9.9') && newer('1.6.0', '') && !newer('1.6.0', '1.6.0') && !newer('1.5.9', '1.6.0'));
});
