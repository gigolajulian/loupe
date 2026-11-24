// EXIT-1: quitting LOUPE ends every process it started, a Processes scan (PowerShell) still running included.
// node scripts/exit-check.js (Windows). Prints BEDROCK-FAIL when anything outlives LOUPE.
const { launch, procs, tree } = require('./run-app');

(async () => {
  if (process.platform !== 'win32') return console.log('EXIT-1 skipped: Windows only');
  // Processes on: a scan starts as soon as the page loads. A stand-in scan that takes 60 s, so it is surely running at quit.
  const slow = require('path').join(require('os').tmpdir(), `loupe-slow-reap-${process.pid}.ps1`);
  require('fs').writeFileSync(slow, 'param([switch]$Json, [string]$AllowFile)\nStart-Sleep 60\n');
  const app = launch({ cfg: { procs: true }, env: { LOUPE_REAP: slow } });
  await app.ready();
  let kids = [], reap = null;
  for (let i = 0; i < 100 && !reap; i++) { // catch the scan while it runs
    kids = tree(procs(), app.proc.pid);
    reap = kids.find(p => (p.CommandLine || '').includes(slow));
  }
  const started = kids.map(p => p.ProcessId);
  await app.quit();
  await app.exited();
  const left = procs().filter(p => started.includes(p.ProcessId) && p.ProcessId !== process.pid);
  if (!reap) throw new Error('the scan never started, so nothing was checked');
  if (left.length) {
    console.log(`BEDROCK-FAIL EXIT-1: ${left.length} process(es) outlived LOUPE:\n${left.map(p => `${p.ProcessId} ${p.Name} ${(p.CommandLine || '').slice(0, 120)}`).join('\n')}`);
    for (const p of left) try { process.kill(p.ProcessId); } catch {}
    process.exit(1);
  }
  console.log(`EXIT-1 ok: ${started.length} processes started (a scan running), none left after quit`);
})().catch(e => { console.log(`BEDROCK-FAIL EXIT-1: ${e.message}`); process.exit(1); });
