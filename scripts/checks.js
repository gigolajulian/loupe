// Repo checks for BASELINE.md rows that a scan proves: node scripts/checks.js <ID>. Prints BEDROCK-FAIL and exits 1
// on a failure. Each ID reads only the files it names.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const workflows = () => fs.readdirSync(path.join(ROOT, '.github', 'workflows')).map(f => read(`.github/workflows/${f}`));
// the code that ships (package.json build.files), scripts included
const APP = [...pkg.build.files.filter(f => /\.(js|html|ps1)$/.test(f)), 'scripts/sign-release.js'];
const problems = [];
const fail = m => problems.push(m);

const CHECKS = {
  // tracked files, and every commit when there is history (CI checks out the full history)
  'SEC-1'() {
    const BEGIN = '-----BEGIN', KEY = 'PRIVATE KEY-----'; // split so this file doesn't match itself
    const re = new RegExp([`${BEGIN} ?[A-Z ]*${KEY}`, 'gh[pousr]_[A-Za-z0-9]{36}', 'github_pat_[A-Za-z0-9_]{60,}',
      'sk-ant-[A-Za-z0-9_-]{20,}', 'AKIA[0-9A-Z]{16}', 'npm_[A-Za-z0-9]{36}', 'xox[abprs]-[A-Za-z0-9-]{10,}'].join('|'));
    const skip = f => /^(\.bedrock\/|node_modules\/)|package-lock\.json$/.test(f);
    const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
    for (const f of git(['ls-files', '-co', '--exclude-standard']).split('\n').filter(f => f && !skip(f))) {
      let text; try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
      if (re.test(text)) fail(`secret-shaped text in ${f}`);
    }
    let history = '';
    try { history = git(['log', '-p', '--all', '--no-color', '--', '.', ':!package-lock.json', ':!.bedrock']); } catch {}
    for (const m of history.matchAll(new RegExp(`^\\+.*(${re.source})`, 'gm'))) fail(`secret-shaped text in history: ${m[1].slice(0, 12)}...`);
  },
  // a committed lockfile that matches package.json, and CI installs from it
  'SEC-3'() {
    const lock = JSON.parse(read('package-lock.json')), root = lock.packages[''];
    if (lock.lockfileVersion < 2) fail('lockfile older than v2');
    for (const k of ['dependencies', 'devDependencies']) for (const [n, v] of Object.entries(pkg[k] || {})) {
      if ((root[k] || {})[n] !== v) fail(`${n}@${v} in package.json, ${(root[k] || {})[n]} in the lockfile`);
      if (!lock.packages[`node_modules/${n}`]) fail(`${n} missing from the lockfile`);
    }
    for (const w of workflows()) {
      if (/npm (install|i)\b/.test(w)) fail('a workflow runs npm install, not npm ci');
      if (!/run: npm ci\b/.test(w)) fail('a workflow does not install with npm ci');
    }
  },
  // known-vulnerable packages fail CI; Dependabot proposes updates for npm and the pinned actions
  'SEC-4'() {
    const d = read('.github/dependabot.yml');
    for (const eco of ['npm', 'github-actions']) if (!new RegExp(`package-ecosystem: "?${eco}"?`).test(d)) fail(`dependabot does not watch ${eco}`);
    if (!workflows().some(w => /run: npm audit --omit=dev --audit-level=high/.test(w))) fail('CI does not run npm audit');
  },
  // random values from crypto only; no hand-rolled or deprecated ciphers
  'SEC-10'() {
    for (const f of APP) {
      const t = read(f);
      if (/Math\.random\(/.test(t)) fail(`${f} uses Math.random`);
      if (/createCipher\(|createHash\('(md5|sha1)'\)/.test(t)) fail(`${f} uses a weak or deprecated crypto call`);
    }
    if (!/crypto\.randomBytes\(16\)/.test(read('pipe.js'))) fail('the pipe name is not from crypto.randomBytes');
  },
  // hooks from an old, dev-folder or worktree LOUPE are found, and Fix hooks leaves only ~/.loupe/relay.js
  'EXIT-3'() {
    const hooks = require('../hooks'), relay = 'C:\Users\X\.loupe\relay.js';
    const settings = { hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'node "C:/Users/X/Documents/Claude/Projects/LOUPE/relay.js"', timeout: 5 }] },
      { hooks: [{ type: 'command', command: 'node C:/Users/X/Documents/Claude/Projects/LOUPE/.claude/worktrees/a-b/relay.js' }] },
    ] } };
    if (hooks.check(settings, relay).stale.length !== 2) fail('old relay paths are not all flagged');
    const fixed = hooks.fix(settings, relay);
    if (/Projects/.test(JSON.stringify(fixed))) fail('after Fix hooks a hook still points into a dev folder');
    if (!hooks.check(fixed, relay).ok) fail('Fix hooks does not leave exactly the LOUPE hooks');
    if (/setLoginItemSettings\(\{ openAtLogin: true \}\)/.test(read('main.js')) && !/app\.isPackaged && !cfg\.loginSet/.test(read('main.js'))) fail('the login item can be set from a dev copy');
  },
  // no trackers or third-party calls: the only remote host is this repo's GitHub releases
  'PRIV-1'() {
    for (const f of APP) {
      // self-tests (after `require.main === module`) never run in the app, so their sample URLs don't count
      const code = read(f).split(/if \(require\.main === module\)/)[0];
      for (const m of code.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
        // nodejs.org: Get Node.js opens it in the browser, LOUPE itself sends nothing there
        if (!/^https:\/\/github\.com\/loupedesk\/loupe\//.test(m[0]) && !/^http:\/\/www\.w3\.org\//.test(m[0]) && m[0] !== 'https://nodejs.org/') fail(`${f} calls ${m[0]}`);
      }
      if (/<script[^>]+src=["']?https?:/i.test(read(f))) fail(`${f} loads a remote script`);
    }
  },
  // text on the open panel, worst case: the default glass over a white desktop, and the Solid glass
  'UX-2'() {
    const css = read('index.html'), v = n => css.match(new RegExp(`--${n}: (#[0-9a-f]{6})`))[1];
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, t) => a.map((x, i) => x * t + b[i] * (1 - t));
    const lum = c => { const [r, g, b] = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const surface = rgb('#101114'), open = +css.match(/\.wrap:has\(\.open\) \.goo \{ opacity: ([.\d]+); \}/)[1];
    const backs = { 'open glass over white': mix(surface, [255, 255, 255], open), solid: surface };
    for (const [bn, b] of Object.entries(backs)) {
      const tile = mix([255, 255, 255], b, 0.05); // .island .tile
      for (const n of ['fg', 'dim', 'faint', 'accent']) {
        const r = ratio(rgb(v(n)), tile);
        if (r < 4.5) fail(`--${n} on a tile, ${bn}: ${r.toFixed(2)}:1, needs 4.5`);
      }
      const r = ratio(rgb('#061214'), rgb(v('accent'))); // the cyan Allow / Submit button
      if (r < 4.5) fail(`text on the accent button: ${r.toFixed(2)}:1`);
    }
  },
  // the installed app shows up as LOUPE, with its icon and publisher
  'DIST-1'() {
    const b = pkg.build;
    if (b.productName !== 'LOUPE' || pkg.productName !== 'LOUPE') fail('productName is not LOUPE');
    if (!b.appId || !pkg.author) fail('no appId or author (publisher)');
    if (!b.icon || !fs.existsSync(path.join(ROOT, b.icon))) fail(`icon ${b.icon} missing`);
    // every local module the app loads is in the installer, or the installed app can't start
    for (const f of b.files.filter(f => f.endsWith('.js'))) for (const m of read(f).matchAll(/require\('\.\/([\w-]+)'\)/g)) {
      if (!b.files.includes(`${m[1]}.js`)) fail(`${f} loads ./${m[1]}, which build.files leaves out of the installer`);
    }
    if (!(b.win && b.win.target === 'nsis') || !b.nsis || b.nsis.shortcutName !== 'LOUPE') fail('Windows build is not the named LOUPE installer');
  },
  // one version (package.json, which the app, the installer and the update feed read) and a notes entry for it
  'REL-9'() {
    const notes = read('CHANGELOG.md');
    if (!new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}\\b`, 'm').test(notes)) fail(`CHANGELOG.md has no entry for ${pkg.version}`);
    for (const f of APP) if (/['"`]\d+\.\d+\.\d+['"`]/.test(read(f))) fail(`${f} hardcodes a version`);
    if (!/app\.getVersion\(\)/.test(read('main.js'))) fail('main.js does not show app.getVersion()');
  },
  // CI: read-only token, actions pinned to a commit, no credentials left in the checkout, no fork-run with secrets
  'REL-7'() {
    for (const w of workflows()) {
      if (!/^permissions:\s*\n\s+contents: read\s*$/m.test(w)) fail('a workflow does not set permissions: contents: read');
      if (/pull_request_target|secrets\./.test(w)) fail('a workflow runs with secrets on pull requests');
      for (const m of w.matchAll(/uses: (\S+)/g)) if (!/@[0-9a-f]{40}$/.test(m[1])) fail(`${m[1]} is not pinned to a commit`);
      if (/actions\/checkout/.test(w) && !/persist-credentials: false/.test(w)) fail('checkout keeps its credentials');
    }
  },
};

const id = process.argv[2];
if (!CHECKS[id]) { console.log(`usage: node scripts/checks.js <${Object.keys(CHECKS).join('|')}>`); process.exit(2); }
CHECKS[id]();
if (problems.length) { console.log(`BEDROCK-FAIL ${id}\n${problems.join('\n')}`); process.exit(1); }
console.log(`${id} ok`);
