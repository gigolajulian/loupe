// Session state from Claude Code hook events. Pure, no Electron.
const path = require('path');

const STEP = {
  Read: 'read', Glob: 'read', Grep: 'read', WebFetch: 'read', WebSearch: 'read',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'run', PowerShell: 'run',
};
const RANK = { need: 0, err: 1, work: 2, think: 3, done: 4, idle: 5 };
const DONE_MS = 5000;
const STALE_MS = 12 * 3600e3; // Code tab sessions rarely send SessionEnd

function detail(ev) {
  const i = ev.tool_input || {};
  return i.command || i.file_path || i.pattern || i.url || '';
}

// what the island asks: a permission card or a question card. No req: the hook didn't wait, so it's answered in
// the thread and the card only mirrors it. at keys the card's × for that one ask.
function ask(ev) {
  if (ev.tool_name === 'AskUserQuestion') {
    return { kind: 'question', req: ev.orb_req, at: ev.orb_ts, questions: (ev.tool_input || {}).questions || [] };
  }
  return {
    kind: 'perm', req: ev.orb_req, at: ev.orb_ts, tool: ev.tool_name, detail: detail(ev),
    always: Array.isArray(ev.permission_suggestions) && ev.permission_suggestions.length > 0,
  };
}

function apply(map, ev) {
  const id = ev.session_id;
  if (!id) return;
  if (ev.hook_event_name === 'SessionEnd') return void map.delete(id);
  let s = map.get(id);
  if (!s) map.set(id, (s = { id, state: 'idle', steps: [], step: null, detail: '', ask: null }));
  // a worktree counts as its project: ...\JG WEBSITE NEW\.claude\worktrees\determined-pike -> JG WEBSITE NEW
  const [root, wt] = (ev.cwd || '').split(/[\\/]\.claude[\\/]worktrees[\\/]/);
  s.name = path.basename(root) || s.name || 'session';
  s.wt = wt ? path.basename(wt) : '';  s.desktop = ev.orb_entry === 'claude-desktop';
  s.host = ev.orb_host || s.host || '';
  s.ts = ev.orb_ts || Date.now();

  switch (ev.hook_event_name) {
    case 'UserPromptSubmit':
      Object.assign(s, { state: 'think', steps: [], step: null, detail: '', ask: null });
      break;
    case 'PreToolUse':
      if (ev.tool_name === 'AskUserQuestion') { s.state = 'need'; s.ask = ask(ev); break; } // shown, answered in the thread
      if (s.ask && !s.ask.req) s.ask = null; // the next tool started, so the mirrored prompt was answered in the thread
      s.state = 'work';
      s.step = STEP[ev.tool_name] || null;
      if (s.step && !s.steps.includes(s.step)) s.steps.push(s.step);
      s.detail = detail(ev);
      break;
    case 'PermissionRequest':
      s.state = 'need'; s.detail = detail(ev); s.ask = ask(ev);
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (s.state === 'need') s.state = 'work';
      s.ask = null;
      break;
    case 'Notification':
      if (ev.notification_type === 'permission_prompt') s.state = 'need';
      break;
    case 'Stop':
      Object.assign(s, { state: 'done', step: 'done', doneAt: Date.now(), ask: null });
      break;
    case 'StopFailure':
      Object.assign(s, { state: 'err', ask: null });
      break;
  }
}

// the request was answered somewhere (island, app dialog, timeout): drop the card
function settle(map, req) {
  for (const s of map.values()) {
    if (s.ask && s.ask.req === req) { s.ask = null; if (s.state === 'need') s.state = 'work'; }
  }
}

// hook output for an answer from the island. null = no decision, Claude Code asks in the app.
function reply(ev, choice) {
  if (choice === 'app') return null;
  if (ev.hook_event_name === 'PermissionRequest') {
    const decision =
      choice === 'deny' ? { behavior: 'deny', message: 'Denied from LOUPE' } :
      choice === 'always' && ev.permission_suggestions ? { behavior: 'allow', updatedPermissions: ev.permission_suggestions } :
      { behavior: 'allow' };
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  // AskUserQuestion: choice = { "question text": "label" or "a, b" }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...ev.tool_input, answers: choice },
    },
  };
}

// done fades to idle, stale drop. Returns sorted list for the UI: needs-you and working first, then latest.
function view(map, now = Date.now()) {
  for (const s of map.values()) {
    if (s.state === 'done' && now - s.doneAt > DONE_MS) s.state = 'idle';
    if (now - s.ts > STALE_MS) map.delete(s.id);
  }
  return [...map.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || b.ts - a.ts);
}

module.exports = { apply, view, settle, reply };

if (require.main === module) {
  const assert = require('assert');
  const m = new Map();
  const e = (hook_event_name, x = {}) => apply(m, { session_id: 'a', cwd: 'C:\\P\\JG WEBSITE NEW', orb_entry: 'claude-desktop', hook_event_name, ...x });
  e('UserPromptSubmit'); assert.equal(m.get('a').state, 'think');
  e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' } });
  e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(m.get('a').steps, ['read', 'run']);

  const perm = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm x' }], behavior: 'allow', destination: 'localSettings' }],
    orb_wait: true, orb_req: 'r1' };
  e('PermissionRequest', perm);
  assert.deepEqual(m.get('a').ask, { kind: 'perm', req: 'r1', at: undefined, tool: 'Bash', detail: 'rm x', always: true });
  apply(m, { session_id: 'b', cwd: '/x/SAVED', hook_event_name: 'UserPromptSubmit' });
  assert.equal(view(m)[0].id, 'a'); // needs-you sorts first
  assert.equal(m.get('b').desktop, false);
  apply(m, { session_id: 'c', cwd: 'C:\\P\\JG WEBSITE NEW\\.claude\\worktrees\\determined-pike-a25369', hook_event_name: 'Stop' });
  assert.equal(m.get('c').name, 'JG WEBSITE NEW');
  assert.equal(m.get('c').wt, 'determined-pike-a25369');

  assert.equal(reply(perm, 'allow').hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(reply(perm, 'deny').hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(reply(perm, 'always').hookSpecificOutput.decision.updatedPermissions[0].type, 'addRules');
  assert.equal(reply(perm, 'app'), null);
  settle(m, 'r1'); assert.equal(m.get('a').ask, null); assert.equal(m.get('a').state, 'work');

  const q = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', orb_wait: true, orb_req: 'r2',
    tool_input: { questions: [{ question: 'Hero ratio?', header: 'Ratio', options: [{ label: '16:9' }, { label: '4:5' }], multiSelect: false }] } };
  e('PreToolUse', q);
  assert.equal(m.get('a').ask.kind, 'question');
  const out = reply(q, { 'Hero ratio?': '4:5' }).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.deepEqual(out.updatedInput.answers, { 'Hero ratio?': '4:5' });
  assert.equal(out.updatedInput.questions.length, 1);

  // not held: mirrored without a req, cleared when the next tool starts
  e('PermissionRequest', { ...perm, orb_wait: false, orb_req: undefined, orb_ts: 7 });
  assert.equal(m.get('a').ask.req, undefined); assert.equal(m.get('a').ask.at, 7);
  e('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'y' } }); assert.equal(m.get('a').ask, null);

  e('Stop'); assert.equal(view(m, Date.now() + 6000).find(s => s.id === 'a').state, 'idle');
  e('SessionEnd'); assert.ok(!m.has('a'));
  console.log('sessions ok');
}
