// Session state from Claude Code hook events. Pure, no Electron.
const base = p => p.split(/[\\/]/).filter(Boolean).pop() || ''; // either separator, so it reads Windows paths on a Mac too

const STEP = {
  Read: 'read', Glob: 'read', Grep: 'read', WebFetch: 'read', WebSearch: 'read',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'run', PowerShell: 'run',
};
const RANK = { need: 0, err: 1, work: 2, think: 3, ready: 4, done: 5, idle: 6 };
const DONE_MS = 5000;
const STALE_MS = 12 * 3600e3; // Code tab sessions rarely send SessionEnd
const TEST_ID = 'loupe-test', TEST_MS = 10e3; // the README's install test clears itself
const MAX_SESSIONS = 200; // far more than anyone runs; past it the least recent goes, so the map can't grow without end

function detail(ev) {
  const i = ev.tool_input || {};
  return i.command || i.file_path || i.pattern || i.url || '';
}

// --- the status line in plain words (rules Julian approved 2026-11-25). Only what the hook events carry: no model.
// 1 the step the thread is on, from its own task list  2 the last note Claude wrote for a call
// 3 a plain noun, never a command or file name  4 cut at a word, never mid-word
const lower = t => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t); // "Check X" -> "check X", like the other states
const KIND = [
  [/\.(jpe?g|png|webp|gif|tiff?|arw|dng|psd|heic|svg)$/i, 'a photo'],
  [/\.(md|txt|pdf|docx?)$/i, 'notes'],
  [/\.(html?|css)$/i, 'a page'],
  [/\.(m?[jt]sx?|cjs|py|cs|ps1|sh|cmd|bat|lua|swift|go|rs|c|cpp|h)$/i, 'code'],
];
function line(s) {
  const step = (s.plan || []).find(p => p.status === 'in_progress');
  if (step) return lower(step.content);
  if (s.desc) return lower(s.desc);
  if (s.tool === 'Grep' || s.tool === 'Glob') return 'searching';
  if (s.tool === 'WebSearch') return 'searching the web';
  if (s.tool === 'WebFetch') return `looking up ${(s.detail || '').replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0]}`.trim();
  if (s.step === 'read' || s.step === 'edit') {
    const kind = (KIND.find(([re]) => re.test(s.detail || '')) || [0, 'a file'])[1];
    return s.step === 'edit' ? `editing ${kind}` : kind === 'a photo' ? 'looking at a photo' : `reading ${kind}`;
  }
  return s.step === 'run' ? 'running a command' : 'working';
}
// at most n characters, the … included; cut at the last space that fits, mid-word only when one word fills the line
function cut(t, n) {
  if (t.length <= n) return t;
  const i = t.lastIndexOf(' ', n - 1);
  return t.slice(0, i > n / 3 ? i : n - 1).replace(/[\s,.:;]+$/, '') + '…';
}
// the thread's task list from the desktop app's update_plan calls: the whole list, then "advance" or done / start (1-based)
// shortcut: terminal task lists (TodoWrite) are not read, no real payload on hand to check against; add when one shows up
function plan(old, i) {
  const ok = x => x && typeof x.content === 'string';
  if (Array.isArray(i.items)) return i.items.filter(ok).slice(0, 12).map(x => ({ content: x.content.slice(0, 200), status: x.status }));
  const p = (old || []).map(x => ({ ...x })), done = x => { if (x) x.status = 'completed'; };
  if (i.advance) { done(p.find(x => x.status === 'in_progress')); const nx = p.find(x => x.status === 'pending'); if (nx) nx.status = 'in_progress'; }
  if (Array.isArray(i.done)) i.done.forEach(n => done(p[n - 1]));
  if (p[i.start - 1]) { p.forEach(x => x.status === 'in_progress' && done(x)); p[i.start - 1].status = 'in_progress'; }
  return p;
}
// widths in characters: a panel row (11px mono, 26 fit the column in Cascadia Mono; wider Mac fonts fall back to the CSS ellipsis), the pill (12px mono, 220px), a Mac notch ear (110px)
const ROW = 26, PILL = 30, EAR = 16;

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
  if (!s) {
    const free = [...map.values()].filter(x => !(x.ask && x.ask.req)); // a held prompt keeps its card
    if (map.size >= MAX_SESSIONS && free.length) map.delete(free.reduce((a, b) => ((b.ts || 0) < (a.ts || 0) ? b : a)).id);
    map.set(id, (s = { id, state: 'idle', steps: [], step: null, detail: '', ask: null, t0: ev.orb_ts || Date.now() })); // t0: rows keep their place
  }
  // a worktree counts as its project: ...\JG WEBSITE NEW\.claude\worktrees\determined-pike -> JG WEBSITE NEW
  const [root, wt] = (ev.cwd || '').split(/[\\/]\.claude[\\/]worktrees[\\/]/);
  s.name = base(root) || s.name || 'session';
  s.cwd = ev.cwd || s.cwd || ''; // Processes: a leftover running from a working session's folder is still in use (#16)
  s.wt = wt ? base(wt) : '';  s.desktop = ev.orb_entry === 'claude-desktop';
  s.host = ev.orb_host || s.host || '';
  s.ts = ev.orb_ts || Date.now();

  switch (ev.hook_event_name) {
    case 'SessionStart': // waiting on its first prompt (#8)
      if (s.state === 'idle') s.state = 'ready';
      break;
    case 'UserPromptSubmit':
      Object.assign(s, { state: 'think', steps: [], step: null, detail: '', desc: '', tool: '', ask: null });
      break;
    case 'PreToolUse':
      if (ev.tool_name === 'AskUserQuestion') { s.state = 'need'; s.ask = ask(ev); break; } // shown, answered in the thread
      if (s.ask && !s.ask.req) s.ask = null; // the next tool started, so the mirrored prompt was answered in the thread
      s.state = 'work';
      s.step = STEP[ev.tool_name] || null;
      if (s.step && !s.steps.includes(s.step)) s.steps.push(s.step);
      s.detail = detail(ev);
      s.tool = ev.tool_name;
      // Bash, PowerShell and Agent calls say what they do in plain words; the note holds while unnamed calls run
      if (typeof (ev.tool_input || {}).description === 'string' && ev.tool_input.description) s.desc = ev.tool_input.description.slice(0, 200);
      if (/update_plan$/.test(ev.tool_name)) s.plan = plan(s.plan, ev.tool_input || {});
      if (/wrap_up$/.test(ev.tool_name)) s.plan = []; // the app checks the list off there
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
  const l = line(s);
  s.line = { row: cut(l, ROW), pill: cut(l, PILL), ear: cut(l, EAR) };
}

// the request was answered somewhere (island, app dialog, timeout): drop the card
function settle(map, req) {
  for (const s of map.values()) {
    if (s.ask && s.ask.req === req) { s.ask = null; if (s.state === 'need') s.state = 'work'; }
  }
}

// hook output for an answer from the island. null = no decision, Claude Code asks in the app. Fails closed: only an
// explicit Allow or Always allows; anything else (a bug, a stray value) goes back to the thread (SEC-5).
function reply(ev, choice) {
  if (ev.hook_event_name === 'PermissionRequest') {
    const decision =
      choice === 'deny' ? { behavior: 'deny', message: 'Denied from LOUPE' } :
      choice === 'always' && ev.permission_suggestions ? { behavior: 'allow', updatedPermissions: ev.permission_suggestions } :
      choice === 'allow' || choice === 'always' ? { behavior: 'allow' } : null;
    return decision && { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  // AskUserQuestion: choice = { "question text": "label" or "a, b" }
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) || !Object.values(choice).every(v => typeof v === 'string')) return null;
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
    if (now - s.ts > (s.id === TEST_ID ? TEST_MS : STALE_MS)) map.delete(s.id);
  }
  return [...map.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || b.ts - a.ts);
}

// the newest agent-name title in a transcript of `size` bytes, read through read(pos, len). Transcripts reach hundreds
// of MB: the first look reads backwards in 1 MB steps, 8 MB at most; later looks read only what was appended after
// `from` (newest 8 MB of it). null = no title in what was read.
const TITLE_RE = /"type":"agent-name","agentName":"((?:[^"\\]|\\.)*)"/g, MB = 1 << 20, FIRST_MAX = 8 * MB;
function lastTitle(read, size, from = -1) {
  let found = null;
  if (from >= 0) { // appended part only, with a little overlap for a line cut at the old end
    const at = Math.max(0, from - 4096, size - FIRST_MAX);
    if (size > at) found = [...read(at, Math.min(size - at, FIRST_MAX)).matchAll(TITLE_RE)].pop();
  } else for (let end = size; end > 0 && size - end < FIRST_MAX && !found; end -= MB - 4096) {
    const at = Math.max(0, end - MB);
    found = [...read(at, end - at).matchAll(TITLE_RE)].pop();
    if (!at) break;
  }
  return found ? JSON.parse(`"${found[1]}"`) : null;
}

module.exports = { apply, view, settle, reply, lastTitle, line, cut };

if (require.main === module) {
  const assert = require('assert');
  const m = new Map();
  const e = (hook_event_name, x = {}) => apply(m, { session_id: 'a', cwd: 'C:\\P\\JG WEBSITE NEW', orb_entry: 'claude-desktop', hook_event_name, ...x });
  e('SessionStart'); assert.equal(m.get('a').state, 'ready');
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
  assert.equal(m.get('c').cwd, 'C:\\P\\JG WEBSITE NEW\\.claude\\worktrees\\determined-pike-a25369');

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

  e('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rg x', description: 'Check the install steps' } });
  assert.equal(m.get('a').desc, 'Check the install steps');
  // plain words: the note holds through unnamed calls, a task-list step beats it, and a new prompt clears the note
  const tool = (tool_name, tool_input = {}) => (e('PreToolUse', { tool_name, tool_input }), m.get('a').line.row);
  assert.equal(tool('Read', { file_path: 'C:\\x\\page.tsx' }), 'check the install steps');
  assert.equal(tool('Bash', { command: 'cd x' }), 'check the install steps');
  const up = 'mcp__ccd_turn__update_plan';
  assert.equal(tool(up, { items: [{ content: 'Read the code', status: 'in_progress' }, { content: 'Build static mock and publish', status: 'pending' }, { content: 'Ship', status: 'pending' }, 7, { content: 9 }] }), 'read the code');
  assert.equal(m.get('a').plan.length, 3); // junk items dropped
  assert.equal(tool(up, { advance: true }), 'build static mock and…');
  assert.equal(m.get('a').line.pill, 'build static mock and publish');
  assert.equal(m.get('a').line.ear, 'build static…');
  assert.equal(tool(up, { done: [2], start: 3 }), 'ship');
  assert.equal(tool(up, { advance: true }), 'check the install steps'); // list finished: back to the note
  tool(up, { items: [{ content: 'Old step', status: 'in_progress' }] });
  assert.equal(tool('mcp__ccd_turn__wrap_up', { recap: 'x' }), 'check the install steps');
  e('UserPromptSubmit');
  assert.equal(tool('Bash', { command: 'cd x && npm test' }), 'running a command'); // never the command name
  assert.equal(tool('Edit', { file_path: 'C:\\x\\hush.py' }), 'editing code');
  assert.equal(tool('Read', { file_path: 'D:\\shots\\sheet-1.JPG' }), 'looking at a photo');
  assert.equal(tool('Write', { file_path: '/x/HANDOFF.md' }), 'editing notes');
  assert.equal(tool('Read', { file_path: '/x/data.bin' }), 'reading a file');
  assert.equal(tool('Grep', { pattern: 'a|b.*c' }), 'searching');
  assert.equal(tool('WebFetch', { url: 'https://www.instagram.com/hush/?x=1' }), 'looking up instagram.com');
  assert.equal(tool('WebSearch', { query: 'x' }), 'searching the web');
  assert.equal(tool('mcp__mail__search', {}), 'working');
  assert.equal(tool('Bash', { command: 'x', description: 7 }), 'running a command'); // a note that is not text is ignored
  assert.equal(cut('probe renderer heap and DOM nodes', 25), 'probe renderer heap and…');
  assert.equal(cut('scan every repo for self-updaters', 25), 'scan every repo for…');
  assert.equal(cut('exactly twenty-five chars', 25), 'exactly twenty-five chars');
  assert.equal(cut('supercalifragilisticexpialidocious words', 12), 'supercalifr…'); // one long word: no space to cut at
  assert.equal(cut('one, two, three', 10), 'one, two…');
  for (const t of ['a b c d e f g h', 'word '.repeat(9)]) for (let n = 4; n < 30; n++) assert.ok(cut(t, n).length <= n);
  apply(m, { session_id: 'loupe-test', cwd: 'C:/LOUPE TEST', hook_event_name: 'UserPromptSubmit' });
  assert.ok(view(m).some(s => s.id === 'loupe-test'));
  assert.ok(!view(m, Date.now() + 11e3).some(s => s.id === 'loupe-test'));

  e('Stop'); assert.equal(view(m, Date.now() + 6000).find(s => s.id === 'a').state, 'idle');
  e('SessionEnd'); assert.ok(!m.has('a'));
  console.log('sessions ok');
}
