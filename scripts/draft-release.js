// First step of `npm run release`: makes the one draft release v<version> before electron-builder uploads to it.
// electron-builder starts two GitHub publishers, and each creates a release when none exists for the tag, so 0.3.5
// and 0.3.6 got a second draft holding the installer and latest.yml. It reuses a draft that is already there, so
// with this step both publishers upload to the same one. Alone: `node scripts/draft-release.js`.
const { execFileSync } = require('child_process');
const { version } = require('../package.json');

const REPO = 'loupedesk/loupe';

// what to do with the releases already on GitHub: 'create', 'reuse', or throw when releasing would go wrong
function decide(releases, v) {
  const same = releases.filter(r => r.tag_name === `v${v}` || r.tag_name === v);
  if (same.length > 1) throw new Error(`${same.length} releases for v${v} (ids ${same.map(r => r.id).join(', ')}): delete the extra drafts first`);
  if (same.length && !same[0].draft) throw new Error(`v${v} is already public: bump the version in package.json`);
  return same.length ? 'reuse' : 'create';
}

module.exports = { decide };

if (require.main === module) {
  const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
  try {
    const step = decide(JSON.parse(gh(['api', `repos/${REPO}/releases?per_page=100`])), version);
    if (step === 'create') gh(['api', '-X', 'POST', `repos/${REPO}/releases`, '-f', `tag_name=v${version}`, '-f', `name=${version}`, '-F', 'draft=true']);
    console.log(`${step === 'create' ? 'created' : 'reusing'} draft v${version}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
