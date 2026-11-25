// Last step of `npm run release`: makes the draft release v<version> public. electron-builder uploads to a draft
// (releaseType: draft in package.json) and this runs only after sign-release.js, so no install ever sees an
// update without its .sig, or one with half its files. Alone: `node scripts/publish-release.js`.
const { execFileSync } = require('child_process');
const { version } = require('../package.json');

execFileSync('gh', ['release', 'edit', `v${version}`, '--draft=false', '-R', 'gigolajulian/loupe'], { stdio: 'inherit' });
console.log(`published v${version}`);
