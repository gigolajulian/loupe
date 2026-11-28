// Claude Code hook wiring for LOUPE: what ~/.claude/settings.json holds and the fix. Pure, no Electron.
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure'];
const LONG = new Set(['PreToolUse', 'PermissionRequest']); // these wait for the island when "Answer prompts on LOUPE" is on

const fwd = p => p.replace(/\\/g, '/');
// node: 'node' (Windows, Claude has it on PATH) or an absolute path (Mac: an app opened from the Dock has a bare PATH)
const command = (relay, node = 'node') => `${/\s/.test(node) ? `"${fwd(node)}"` : fwd(node)} "${fwd(relay)}"`;
// this relay, run by plain node or by any absolute node
const ours = (c, relay) => c.endsWith(` "${fwd(relay)}"`) && /^("[^"]*node(\.exe)?"|\S*node(\.exe)?) "/i.test(c);
const timeout = name => (LONG.has(name) ? 3600 : 5);
// any LOUPE relay, on any path (the project folder, C:\LOUPE, the old ORB name)
const isLoupe = c => /relay\.js/i.test(c) && /loupe|orb/i.test(c);
const isCoucou = c => /coucou/i.test(c);
const all = settings => Object.entries((settings && settings.hooks) || {})
  .flatMap(([name, groups]) => (Array.isArray(groups) ? groups : []).flatMap(g => (g.hooks || []).map(h => ({ name, h }))));

function check(settings, relay) {
  const hooks = all(settings);
  const events = EVENTS.map(name => {
    const mine = hooks.filter(x => x.name === name && ours(x.h.command || '', relay));
    return { name, ok: mine.length === 1 && mine[0].h.timeout === timeout(name), count: mine.length };
  });
  const stale = hooks.filter(x => isLoupe(x.h.command || '') && !ours(x.h.command || '', relay)).map(x => `${x.name}: ${x.h.command}`);
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
function fix(settings, relay, node) {
  const out = strip(settings, c => isLoupe(c) || isCoucou(c)), hooks = out.hooks;
  for (const name of EVENTS) {
    (hooks[name] = hooks[name] || []).push({ hooks: [{ type: 'command', command: command(relay, node), timeout: timeout(name) }] });
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
  // Mac: an absolute node passes the check, and Fix with it swaps plain node for it
  const mac = fix(f, '/Users/x/.loupe/relay.js', '/opt/homebrew/bin/node');
  assert.ok(check(mac, '/Users/x/.loupe/relay.js').ok);
  assert.equal(mac.hooks.Stop.at(-1).hooks[0].command, '/opt/homebrew/bin/node "/Users/x/.loupe/relay.js"');
  const pf = 'C:\\Program Files\\nodejs\\node.exe';
  assert.ok(check(fix({}, relay, pf), relay).ok);
  assert.equal(command(relay, pf), '"C:/Program Files/nodejs/node.exe" "C:/Users/X/.loupe/relay.js"');
  assert.ok(!check({ hooks: { Stop: [{ hooks: [{ command: 'python "C:/Users/X/.loupe/relay.js"', timeout: 5 }] }] } }, relay).events.at(-2).ok);
  console.log('hooks ok');
}
