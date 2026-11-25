// Claude Code hook wiring for LOUPE: what ~/.claude/settings.json holds and the fix. Pure, no Electron.
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure'];
const LONG = new Set(['PreToolUse', 'PermissionRequest']); // these wait for the island when "Answer prompts on LOUPE" is on

const command = relay => `node "${relay.replace(/\\/g, '/')}"`;
const timeout = name => (LONG.has(name) ? 3600 : 5);
// any LOUPE relay, on any path (the project folder, C:\LOUPE, the old ORB name)
const isLoupe = c => /relay\.js/i.test(c) && /loupe|orb/i.test(c);
const isCoucou = c => /coucou/i.test(c);
const all = settings => Object.entries((settings && settings.hooks) || {})
  .flatMap(([name, groups]) => (Array.isArray(groups) ? groups : []).flatMap(g => (g.hooks || []).map(h => ({ name, h }))));

function check(settings, relay) {
  const want = command(relay), hooks = all(settings);
  const events = EVENTS.map(name => {
    const mine = hooks.filter(x => x.name === name && x.h.command === want);
    return { name, ok: mine.length === 1 && mine[0].h.timeout === timeout(name), count: mine.length };
  });
  const stale = hooks.filter(x => isLoupe(x.h.command || '') && x.h.command !== want).map(x => `${x.name}: ${x.h.command}`);
  const coucou = hooks.filter(x => isCoucou(x.h.command || '')).map(x => `${x.name}: ${x.h.command}`);
  return { events, stale, coucou, ok: events.every(e => e.ok) && !stale.length && !coucou.length };
}

// a copy without the hooks whose command matches drop; groups and events left empty go too. Other hooks stay as they are.
function strip(settings, drop) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  const hooks = out.hooks = out.hooks || {};
  for (const name of Object.keys(hooks)) {
    if (!Array.isArray(hooks[name])) continue;
    hooks[name] = hooks[name].flatMap(g => {
      if (!Array.isArray(g.hooks)) return [g];
      const keep = g.hooks.filter(h => !drop(h.command || ''));
      return keep.length === g.hooks.length ? [g] : keep.length ? [{ ...g, hooks: keep }] : [];
    });
    if (!hooks[name].length) delete hooks[name];
  }
  return out;
}

// uninstall (EXIT-2): only LOUPE's own hooks go
const remove = settings => strip(settings, isLoupe);

// drops every LOUPE and Coucou hook, then adds one LOUPE entry per event. Other hooks stay as they are.
function fix(settings, relay) {
  const out = strip(settings, c => isLoupe(c) || isCoucou(c)), hooks = out.hooks;
  for (const name of EVENTS) {
    (hooks[name] = hooks[name] || []).push({ hooks: [{ type: 'command', command: command(relay), timeout: timeout(name) }] });
  }
  return out;
}

module.exports = { EVENTS, check, fix, remove, command };

if (require.main === module) {
  const assert = require('assert');
  const relay = 'C:\\Users\\X\\.loupe\\relay.js';
  const s = { model: 'opus', hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'python guard.py' }] },
      { hooks: [{ type: 'command', command: 'node "C:/Users/X/Documents/LOUPE/relay.js"', timeout: 3600 }] },
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'node C:/coucou/hook.js' }, { type: 'command', command: 'say done' }] }],
  } };
  const before = check(s, relay);
  assert.equal(before.ok, false);
  assert.equal(before.stale.length, 1);
  assert.equal(before.coucou.length, 1);
  const f = fix(s, relay);
  const after = check(f, relay);
  assert.ok(after.ok, JSON.stringify(after));
  assert.equal(f.model, 'opus');
  assert.deepEqual(f.hooks.PreToolUse[0], s.hooks.PreToolUse[0]); // other hooks untouched
  assert.deepEqual(f.hooks.Stop[0].hooks, [{ type: 'command', command: 'say done' }]);
  assert.equal(f.hooks.PreToolUse.at(-1).hooks[0].timeout, 3600);
  assert.equal(f.hooks.Stop.at(-1).hooks[0].timeout, 5);
  assert.deepEqual(fix(f, relay), f); // fixing twice changes nothing
  assert.ok(check(fix({}, relay), relay).ok);
  const r = remove(f); // only LOUPE's hooks go, Coucou and the rest stay
  assert.deepEqual(r.hooks.PreToolUse, [s.hooks.PreToolUse[0]]);
  assert.deepEqual(r.hooks.Stop, [{ hooks: [{ type: 'command', command: 'say done' }] }]);
  assert.ok(!JSON.stringify(remove(s)).includes('relay.js') && JSON.stringify(remove(s)).includes('coucou'));
  console.log('hooks ok');
}
