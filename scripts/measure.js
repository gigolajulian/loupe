// MEM-2, EXIT-4, PERF-2: start time, then memory and CPU of LOUPE's whole process tree every 30 s for 10 min idle and
// 10 min in use (8 sessions sending hook events every 2 s). Windows, scratch profile (run-app.js).
//   node scripts/measure.js [minutes per phase, default 10] > out.json
const { launch, procs, tree } = require('./run-app');

const MIN = +(process.argv[2] || 10), MB = 1 << 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sample = pid => {
  const t = tree(procs(), pid);
  return { n: t.length, privateMB: t.reduce((a, p) => a + +p.PrivatePageCount, 0) / MB, wsMB: t.reduce((a, p) => a + +p.WorkingSetSize, 0) / MB,
    cpu100ns: t.reduce((a, p) => a + +p.KernelModeTime + +p.UserModeTime, 0) };
};

(async () => {
  const starts = [];
  for (let i = 0; i < 3; i++) { // cold-ish starts: a fresh profile each time
    const a = launch();
    starts.push(await a.ready());
    await a.quit(); await a.exited();
  }
  const app = launch();
  await app.ready();
  await sleep(30e3); // warm-up
  const out = { startMs: starts, cores: require('os').cpus().length, phases: {} };
  for (const phase of ['idle', 'use']) {
    let busy = null, i = 0;
    if (phase === 'use') busy = setInterval(() => {
      const s = `s${i % 8}`, n = i++ % 6, cwd = `C:\\P\\project ${i % 8}`;
      const ev = [{ hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: `C:\\P\\f${i}.js` } },
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `npm test -- ${i}`, description: 'Run the tests' } },
        { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } },
        { hook_event_name: 'PostToolUse' }, { hook_event_name: 'Stop' }][n];
      app.send({ session_id: s, cwd, orb_ts: Date.now(), ...ev }).catch(() => {});
    }, 2000 / 8);
    const rows = [], t0 = Date.now();
    for (let k = 0; k <= MIN * 2; k++) {
      const s = sample(app.proc.pid);
      rows.push({ t: Math.round((Date.now() - t0) / 1000), ...s, privateMB: +s.privateMB.toFixed(1), wsMB: +s.wsMB.toFixed(1) });
      if (k < MIN * 2) await sleep(30e3);
    }
    clearInterval(busy);
    const secs = (rows.at(-1).t - rows[0].t) || 1, cpu = (rows.at(-1).cpu100ns - rows[0].cpu100ns) / 1e7;
    out.phases[phase] = { rows, cpuPctOfOneCore: +(100 * cpu / secs).toFixed(3), cpuPctOfMachine: +(100 * cpu / secs / out.cores).toFixed(3),
      privateMB: { first: rows[0].privateMB, max: Math.max(...rows.map(r => r.privateMB)), last: rows.at(-1).privateMB },
      wsMB: { first: rows[0].wsMB, max: Math.max(...rows.map(r => r.wsMB)), last: rows.at(-1).wsMB } };
    console.error(phase, JSON.stringify(out.phases[phase].privateMB), 'cpu% of a core', out.phases[phase].cpuPctOfOneCore);
  }
  await app.quit(); await app.exited();
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
