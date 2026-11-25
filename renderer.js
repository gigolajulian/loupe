// One dotted orb (thinking-orbs engine, MIT) shows the most urgent session. The list under it is plain text.
import { resolvePreset, MODE_FRAMES } from './node_modules/thinking-orbs/dist/engine.es.js';

let claudeFront = false; // Claude's window is in front (main.js): no "needs you" sound, no panel popping open
window.loupe.onFront(on => { claudeFront = on; });
const $ = id => document.getElementById(id);
const island = $('island'), sess = $('sess'), more = $('more'), verbEl = $('verb'), projEl = $('proj');
const orbs = [$('orb-s'), $('orb-l')]; // collapsed and open sizes, same state
const rows = new Map();
let hovered = false, last = [];

// Mac: main passes the notch size (pt) as ?notch=WxH; index.html's .notch rules shape the island around it
const notch = new URLSearchParams(location.search).get('notch');
if (notch) {
  const [w, h] = notch.split('x'), r = document.documentElement;
  r.classList.add('notch');
  r.style.setProperty('--notch-w', w + 'px');
  r.style.setProperty('--notch-h', h + 'px');
}

const INK = { white: [236, 236, 236], cyan: [95, 195, 211], dim: [78, 78, 84] };

function look(s) {
  switch (s && s.state) {
    case 'need': return { anim: 'listening', ink: 'cyan' };
    case 'work': return { anim: 'working', ink: 'white' }; // one look for every call: a shape per call was distracting
    case 'think': return { anim: 'breathing', ink: 'white' };
    case 'done': return { anim: 'breathing', ink: 'white', still: true };
    // stopped: the searching globe, frozen and with its scan sweep switched off
    case 'err': return { anim: 'searching', ink: 'white', still: true, opts: { scanMul: 0 } };
    default: return { anim: 'breathing', ink: 'dim', still: true, logo: true }; // nothing going on: the orb folds into the LOUPE mark
  }
}

// where: 'row' (panel), 'pill' or 'ear' (Mac notch). The plain-words line comes from sessions.js, cut at a word for each
function verb(s, where = 'row') {
  switch (s.state) {
    case 'need': return 'needs you';
    case 'think': return 'thinking';
    case 'work': return (s.line && s.line[where]) || 'working';
    case 'done': return 'done';
    case 'ready': return 'ready';
    case 'err': return 'stopped';
    default: return `idle ${ago(s.ts)}`;
  }
}
const ago = ts => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

// --- orb drawing: the engine returns z-sorted dots with `white` as paper ink; on black we mirror it
const dpr = Math.min(2, devicePixelRatio || 1);
orbs.forEach(c => {
  const size = +c.dataset.size, px = +c.dataset.px;
  c.width = c.height = px * dpr;
  c.style.width = c.style.height = px + 'px';
  c._k = (px * dpr) / size;
  c._ctx = c.getContext('2d');
});
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
// new text fades in instead of snapping
function say(el, t) {
  if (el.textContent === t) return;
  el.textContent = t;
  if (!reduce.matches && getComputedStyle(el).opacity !== '0') el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
}
// #5 #6 #11: a new mode morphs in over BLEND and holds at least HOLD, so quick tool hops read as one movement.
// Waking from idle, the mark unfolds and the speed eases up from rest over EASE_IN. Needs-you pulses at WAIT speed.
// Idle, the mark drifts a fraction of a pixel. Values picked in the issue mock (2026-11-21).
const BLEND = 400, HOLD = 600, EASE_IN = 900, WAIT = 0.45, DRIFT = 0.5;
let cur = look(null), rgb = [...INK.dim];
let from = null, blendAt = 0, next = null, switchedAt = -1e9, rate = 1, clock = 0;
let fold = 1, foldTo = 1; // 0 = orb, 1 = LOUPE mark (three dots, cyan centre, as in logo/icons.mjs)
const MARK = [INK.white, INK.cyan, INK.white];
const key = l => [l.anim, l.ink, !!l.still, !!l.logo].join();
function setLook(l) { if (key(l) !== key(next || cur)) { next = l; kick(); } }

const frameOf = (l, size, t) => {
  const { mode, speed, opts } = resolvePreset(l.anim, size);
  return MODE_FRAMES[mode](size, t * speed, l.opts ? { ...opts, ...l.opts } : opts);
};
function draw(c, t, w, now) {
  const size = +c.dataset.size;
  const fb = frameOf(cur, size, t), fa = from ? frameOf(from, size, t) : null;
  const [r, g, b] = rgb.map(Math.round), ctx = c._ctx;
  const m = fold * fold * (3 - 2 * fold); // smoothstep
  const s = Math.max(0, (m - 0.6) / 0.4); // solid mark fades in over the last 40%
  ctx.setTransform(c._k, 0, 0, c._k, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const lines = (f, k) => { for (const l of f.lines || []) {
    ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - l.white) * (l.a ?? 1) * k * (1 - m)})`;
    ctx.lineWidth = l.w;
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
  } };
  if (m < 1) { lines(fb, fa ? w : 1); if (fa) lines(fa, 1 - w); }
  // blending: dots pair up by index and slide from the old mode's spot to the new one's; unpaired ones fade
  const al = d => (1 - d.white) * (d.a ?? 1);
  let dots = fb.dots;
  if (fa) {
    dots = [];
    for (let i = 0; i < Math.max(fa.dots.length, fb.dots.length); i++) {
      const p = fa.dots[i], q = fb.dots[i];
      dots.push(p && q ? { x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w, r: p.r + (q.r - p.r) * w, al: al(p) * (1 - w) + al(q) * w }
        : p ? { ...p, al: al(p) * (1 - w) } : { ...q, al: al(q) * w });
    }
  }
  // each dot slides to the mark dot of its third, left to right, and takes that dot's size and color
  const rank = new Map(dots.map((d, i) => [d, i]).sort((a, b) => a[0].x - b[0].x).map(([d], i) => [d, i]));
  for (const d of dots) {
    const k = Math.min(2, Math.floor(rank.get(d) * 3 / dots.length)), ink = MARK[k];
    const a = d.al ?? al(d);
    const x = d.x + (size / 2 + (k - 1) * size * 0.34 - d.x) * m, y = d.y + (size / 2 - d.y) * m;
    const [cr, cg, cb] = [r, g, b].map((v, i) => Math.round(v + (ink[i] - v) * m));
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * (1 - s)})`;
    ctx.beginPath(); ctx.arc(x, y, Math.max(0, d.r + (size * 0.14 - d.r) * m), 0, Math.PI * 2); ctx.fill();
  }
  // stacked translucent dots read muddy, so the last stretch hands over to three solid circles. Idle, they drift
  // on their own slow cycles and the centre one breathes a little.
  const drift = reduce.matches ? 0 : DRIFT, ts = now / 1000;
  if (s > 0) MARK.forEach((ink, k) => {
    const dy = drift * size * 0.035 * Math.sin(ts * 2 * Math.PI / 6 + k * 2.1);
    const a = k === 1 ? 1 - drift * 0.25 * (0.5 + 0.5 * Math.sin(ts * 2 * Math.PI / 5)) : 1;
    ctx.fillStyle = `rgba(${ink.join(',')},${s * a})`;
    ctx.beginPath(); ctx.arc(size / 2 + (k - 1) * size * 0.34, size / 2 + dy, size * 0.14, 0, Math.PI * 2); ctx.fill();
  });
}

// frames run only while the orb moves, blends, eases or drifts; a still orb costs nothing between kicks.
// Drifting alone runs at 5 fps (a sub-pixel drift: more fps cost CPU and GPU for nothing you can see), the rest at 30.
// Drifting waits on a timer, not on every display refresh: skipped rAF ticks at 60-144 Hz were most of LOUPE's idle CPU.
let raf = 0, idle = 0, lastDraw = 0, slow = false;
function frame(now) {
  raf = 0;
  if (now - lastDraw < (slow ? 180 : 30)) { raf = requestAnimationFrame(frame); return; }
  const dt = Math.min(0.1, (now - lastDraw) / 1000);
  lastDraw = now;
  if (next && now - switchedAt >= HOLD) {
    // blend between two dotted modes; to and from the mark, the fold does the morph
    if (next.anim !== cur.anim && !cur.logo && !next.logo && !reduce.matches) { from = cur; blendAt = now; }
    if (cur.logo && !next.logo) rate = 0; // waking from idle
    cur = next; next = null; switchedAt = now;
  }
  const w = from ? Math.min(1, (now - blendAt) / BLEND) : 1;
  const want = INK[cur.ink];
  rgb = rgb.map((v, i) => v + (want[i] - v) * 0.16); // ink eases to the new color over ~0.5 s at 30 fps
  const settled = rgb.every((v, i) => Math.abs(v - want[i]) < 0.5);
  if (settled) rgb = [...want];
  foldTo = cur.logo ? 1 : 0;
  const fstep = dt / (foldTo ? 0.6 : EASE_IN / 1000); // folds in 0.6 s, unfolds over EASE_IN
  fold = reduce.matches ? foldTo : fold + Math.sign(foldTo - fold) * Math.min(Math.abs(foldTo - fold), fstep);
  rate = reduce.matches ? 1 : Math.min(1, rate + dt * 1000 / EASE_IN);
  const folding = fold !== foldTo;
  const still = (cur.still && !folding && !from) || reduce.matches;
  if (!still) clock += dt * (cur.anim === 'listening' ? WAIT : 1) * rate * rate;
  const drifting = cur.logo && !folding && !reduce.matches;
  for (const c of orbs) if (c.offsetParent) draw(c, still ? 2 : clock, w * w * (3 - 2 * w), now); // hidden canvas: skip
  if (w >= 1) from = null;
  const busy = !still || !settled || folding || from || next;
  slow = !busy && drifting;
  if (busy) raf = requestAnimationFrame(frame);
  else if (drifting) idle = setTimeout(kick, 200);
}
const kick = () => { clearTimeout(idle); idle = 0; if (!raf) raf = requestAnimationFrame(frame); };
kick();
reduce.addEventListener('change', kick);

// a session's step in its project, from its title: "JG - QA" -> QA, "Website: booking card" -> booking card
const step = s => {
  const t = (s.title || '').replace(/^[^:-]*?\s(?:-|:)\s+|^[^:]+:\s+/, '');
  return t && t.toUpperCase() !== s.name.toUpperCase() ? t : s.wt || '';
};
const active = s => s.state === 'need' || s.state === 'work' || s.state === 'think';

// --- session list: one keyed cell per active thread, its name on top and what it's doing under it, reordered in place
const title = s => s.title || [s.name, s.wt].filter(Boolean).join(' › ');
function sync(list) {
  const live = new Set(list.map(s => s.id));
  for (const [k, r] of rows) if (!live.has(k)) { r.remove(); rows.delete(k); }
  list.forEach((s, i) => {
    let r = rows.get(s.id);
    if (!r) {
      r = document.createElement('div');
      r.innerHTML = '<div class="top"><span class="n"></span><span class="bg"></span></div><div class="v"></div>';
      rows.set(s.id, r);
    }
    r.onclick = () => { if (!dragged) window.loupe.open(s.id); };
    const want = i === 0 ? sess.firstChild : rows.get(list[i - 1].id).nextSibling;
    if (r !== want) sess.insertBefore(r, want || more);
    r.className = 'r' + (s.state === 'need' ? ' need' : s.state === 'ready' ? ' new' : active(s) ? '' : ' quiet')
      + (!active(s) && s.state !== 'ready' && !(i && !active(list[i - 1]) && list[i - 1].state !== 'ready') ? ' first' : '') + (s.desktop ? '' : ' term') + (s.host ? ' go' : '');
    r.querySelector('.n').textContent = r.title = title(s);
    say(r.querySelector('.v'), verb(s));
    const bg = bgCount(s.id);
    r.querySelector('.bg').textContent = bg ? `${bg} bg` : '';
  });
}

// cards closed with the × stay closed for that ask; mirrored asks have no req, so key them by session + arrival
const dismissed = new Set();
const askKey = s => s.ask.req || `${s.id}:${s.ask.at}`;

// the pill stays on one thread while it works, so it doesn't flip between threads on every call; needs-you and stopped still win
let pinned = null;
function top(list) {
  const s = list.find(x => x.state === 'need' || x.state === 'err') || list.find(x => x.id === pinned && active(x)) || list[0];
  pinned = s ? s.id : null;
  return s;
}

window.loupe.onState(render);
function render(list) {
  last = list;
  // the open list shows only active threads: working, thinking or waiting on you
  const act = list.filter(active), app = act.filter(s => s.desktop), termS = act.filter(s => !s.desktop), term = termS.length;

  island.classList.toggle('empty', !list.length);
  const head = top(list);
  island.classList.toggle('idle', !!head && (head.state === 'idle' || head.state === 'done')); // lighter glass
  const asking = list.filter(s => s.ask && !dismissed.has(askKey(s)));
  // Claude in front: you answer there, so the panel doesn't pop open. The orb still shows "needs you".
  if (!closing) setOpen(hovered || (!claudeFront && (asking.length > 0 || list.some(s => s.state === 'need' && !s.ask))));

  const lk = look(head);
  setLook(lk);
  say(projEl, head ? [head.name, step(head)].filter(Boolean).join(' › ') : '');
  say(verbEl, head ? verb(head, notch ? 'ear' : 'pill') : '');
  verbEl.classList.toggle('need', lk.ink === 'cyan');

  const calm = !act.length;
  // busy to calm: free the memory the busy panel used once it has settled, instead of minutes later (MEM-2)
  if (calm && !island.classList.contains('calm')) trimSoon = setTimeout(() => window.loupe.trim(), 5000);
  if (!calm) clearTimeout(trimSoon);
  island.classList.toggle('calm', calm);
  // #8: new sessions show "ready" with the active ones; up to four recent idle ones sit under them, dimmed
  const ready = list.filter(s => s.state === 'ready' && s.desktop), recent = list.filter(s => !active(s) && s.state !== 'ready' && s.desktop).slice(0, 4);
  sync([...app.slice(0, 8).sort((a, b) => a.t0 - b.t0), ...ready, ...termS, ...recent]); // rows keep their place: by start, not by latest event
  const need = act.filter(s => s.state === 'need').length, n = app.length;
  $('hd').innerHTML = calm ? 'nothing running' : `<b>${n} active</b>${need ? ` · ${need} need${need === 1 ? 's' : ''} you` : ''}${ready.length ? ` · ${ready.length} ready` : ''}`;
  more.textContent = term ? `${sess.classList.contains('showterm') ? '−' : '+'}${term} terminal` : '';

  island.classList.toggle('asking', asking.length > 0);
  renderAsk(asking[0], asking.length - 1);
  cues(list);
  renderProcs();
}

// --- audio cues, synthesized (picked in cues.html): N4 needs you, D1 done, E1 error
let sound = true;
const actx = new AudioContext(), master = actx.createGain(); // master = volume slider
master.connect(actx.destination);
function note(f, at, len, type, peak) {
  const t = actx.currentTime + at, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.05);
}

// open panel: speaker at top right, click shows the volume slider (0 = silent); saved through main's config
const muteEl = $('mute'), volEl = $('volume');
function showSound() {
  const off = !sound || +volEl.value === 0;
  muteEl.classList.toggle('off', off);
  muteEl.querySelector('use').setAttribute('href', off ? '#muted' : '#vol');
}
muteEl.onclick = () => muteEl.parentElement.classList.toggle('show');
// right click: mute / unmute, same switch as the tray's Sounds
muteEl.oncontextmenu = e => { e.preventDefault(); sound = !sound; window.loupe.setConfig({ sound }); showSound(); };
volEl.oninput = () => { master.gain.value = +volEl.value; showSound(); };
volEl.onchange = () => { window.loupe.setConfig({ volume: +volEl.value }); if (sound) CUE.done(); }; // preview the level
const CUE = {
  need: () => { note(330, 0, .18, 'sine', .3); note(440, .12, .3, 'sine', .22); },
  done: () => note(1760, 0, .06, 'sine', .12),
  err: () => { note(220, 0, .15, 'triangle', .25); note(196, .17, .25, 'triangle', .25); },
};
let trimSoon = 0;
const seen = new Map(); // session id -> last state; a session's first sighting stays silent
function cues(list) {
  for (const s of list) {
    const was = seen.get(s.id);
    if (sound && was && was !== s.state && CUE[s.state] && !(claudeFront && s.state === 'need')) CUE[s.state]();
    seen.set(s.id, s.state);
  }
}

// ask card: rebuilt only when the request changes, so a half-picked multi-select survives state pushes
const askEl = $('card');
const ICON = { Bash: 'run', PowerShell: 'run', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Read: 'read' };
let shown = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function btn(text, cls, onClick) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
  b.onclick = onClick;
  return b;
}

function renderAsk(s, waiting) {
  const key = s ? askKey(s) : null;
  if (key === shown) {
    const w = askEl.querySelector('.wait');
    if (w) w.textContent = waiting > 0 ? `+${waiting} waiting` : '';
    return;
  }
  shown = key;
  window.loupe.focus(false); // a new card or none: give the keyboard back
  askEl.replaceChildren();
  if (!s) return;
  const a = s.ask, send = choice => { shown = null; window.loupe.answer(a.req, choice); };

  const who = el('div', 'who');
  who.append(el('b', '', s.name), ...(step(s) ? [el('span', 'st', step(s))] : []));
  if (a.kind === 'perm') { // the tool, as its icon or its name
    const t = el('span', 't');
    t.innerHTML = `<svg class="i" style="width:13px;height:13px"><use href="#${ICON[a.tool] || 'run'}"/></svg>`;
    if (!ICON[a.tool]) t.append(a.tool);
    who.append(t);
  }
  who.append(el('span', 'sp'), el('span', 'wait', waiting > 0 ? `+${waiting} waiting` : ''));
  const inApp = el('button', 'link');
  inApp.title = 'Answer in Claude';
  inApp.innerHTML = '<svg class="i" style="width:13px;height:13px"><use href="#out"/></svg>';
  inApp.onclick = () => { if (a.req) send('app'); window.loupe.open(s.id); };
  // ×: close the card here. A held ask goes back to Claude Code, which then asks in the thread
  const close = el('button', 'link');
  close.title = 'Dismiss';
  close.innerHTML = '<svg class="i" style="width:13px;height:13px"><use href="#x"/></svg>';
  close.onclick = () => { dismissed.add(key); if (a.req) send('app'); shown = null; render(last); };
  who.append(inApp, close);
  askEl.append(who);

  if (a.kind === 'perm') {
    if (a.detail) askEl.append(el('div', 'code', a.detail));
    if (!a.req) return; // mirrored: answered in the thread, the card only shows it
    const row = el('div', 'btns');
    row.append(btn('Allow', 'pri', () => send('allow')), btn('Deny', '', () => send('deny')));
    if (a.always) row.append(btn('Always', '', () => send('always')));
    askEl.append(row);
    return;
  }

  // pick, then Submit at the bottom. Held: Submit answers here, and Other takes a typed answer.
  // Mirrored: only the thread can answer, so the button opens the session there.
  const OTHER = '\0other', picks = {}, typed = {};
  const val = (q, l) => (l === OTHER ? typed[q.question].value.trim() : l);
  const done = () => a.questions.every(q => picks[q.question] && picks[q.question].length && picks[q.question].every(l => val(q, l)));
  const answers = () => Object.fromEntries(a.questions.map(q => [q.question, picks[q.question].map(l => val(q, l)).join(', ')]));
  const pick = (q, label, row) => {
    const cur = picks[q.question] || [];
    picks[q.question] = !q.multiSelect ? [label] : cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label];
    row.querySelectorAll('.opt').forEach(x => x.classList.toggle('sel', picks[q.question].includes(x.dataset.label)));
    const other = picks[q.question].includes(OTHER);
    row.classList.toggle('typing', other);
    // typing needs keyboard focus, which LOUPE otherwise never takes; it gives it back on answer or dismiss
    if (other && label === OTHER) { window.loupe.focus(true); typed[q.question].focus(); }
    if (a.req) submit.disabled = !done();
  };
  a.questions.forEach(q => {
    askEl.append(el('div', 'q', q.question));
    const row = el('div', 'opts');
    const opt = (label, i, text, desc, rec) => {
      const b = el('button', 'opt');
      b.dataset.label = label;
      b.append(el('span', 'k', String(i + 1)), el('span', 'l', text), el('span', 'd', desc || ''), ...(rec ? [el('span', 'rec', 'rec')] : []));
      b.onclick = () => pick(q, label, row);
      row.append(b);
    };
    (q.options || []).forEach((o, i) => {
      const rec = /\s*\(Recommended\)\s*$/i.test(o.label);
      opt(o.label, i, o.label.replace(/\s*\(Recommended\)\s*$/i, ''), o.description, rec);
    });
    if (a.req) {
      opt(OTHER, (q.options || []).length, 'Other', 'Write your own answer');
      const t = typed[q.question] = el('textarea', 'other');
      t.rows = 2; t.placeholder = 'Type your answer';
      t.oninput = () => { submit.disabled = !done(); };
      t.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (done()) submit.click(); } };
      row.append(t);
    }
    askEl.append(row);
  });
  // mirrored: Claude owns it, so the button just opens the session there, no picking needed (#14)
  const submit = btn(a.req ? 'Submit' : 'Answer in Claude', 'pri', () => { if (!a.req) return window.loupe.open(s.id); if (done()) send(answers()); });
  submit.disabled = !!a.req;
  const ft = el('div', 'btns');
  ft.append(submit);
  askEl.append(ft);
}

// --- open / close: the island morphs between its two sizes, content fades in on top
const EASE = 'cubic-bezier(.32,.72,0,1)'; // fast start, long soft settle
let morph = null, fading = null, closeDelay = 300, closing = null;
window.loupe.onConfig(c => {
  closeDelay = c.closeDelay; sound = c.sound;
  procsCfg = { ok: !!c.procsOk, on: !!c.procs, asked: !!c.procsAsked };
  if (!procsCfg.on) { procs = null; pview = false; }
  renderProcs();
  document.body.classList.toggle('goo-on', c.goo);
  document.documentElement.classList.toggle('dock', !!c.dock);
  document.documentElement.classList.toggle('glass-dark', (c.glass || 'dark') === 'dark');
  document.documentElement.classList.toggle('glass-solid', c.glass === 'solid');
  volEl.value = master.gain.value = c.volume;
  showSound();
});

function setOpen(open) {
  if (island.classList.contains('open') === open && !fading) return;
  if (!open) muteEl.parentElement.classList.remove('show'); // slider starts hidden next time
  if (!open) { pview = false; pask = null; review = false; } // opens on the thread list next time
  if (morph) morph.cancel();
  if (fading) { fading.cancel(); fading = null; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!open && !reduce && island.classList.contains('open')) {
    // closing: let the open content fade out first, then shrink
    fading = island.querySelector('.body').animate(
      [{ opacity: 1 }, { opacity: 0 }], // no blur filter: blurring text every frame stutters
      { duration: 120, easing: 'ease-out', fill: 'forwards' });
    fading.onfinish = () => { fading.cancel(); fading = null; renderProcs(); resize(false); };
    return;
  }
  if (open && procsCfg.on) window.loupe.procs();
  if (!open) renderProcs();
  if (!reduce) resize(open); else island.classList.toggle('open', open);
  kick(); // the other canvas just became visible
}

function resize(open) {
  const a = island.getBoundingClientRect();
  island.classList.toggle('open', open);
  kick();
  const b = island.getBoundingClientRect();
  morph = island.animate(
    [{ width: a.width + 'px', height: a.height + 'px' }, { width: b.width + 'px', height: b.height + 'px' }],
    { duration: open ? 520 : 440, easing: EASE });
  if (document.body.classList.contains('goo-on')) drip(open, a.height, b.height);
  (open ? island.querySelector('.body') : island.querySelector('.mini')).animate(
    [{ opacity: 0, transform: 'translateY(-4px) scale(.98)' }, { opacity: 1, transform: 'none' }],
    { duration: open ? 420 : 320, delay: open ? 110 : 140, easing: EASE, fill: 'backwards' });
}

// gooey droplet: on expand it overshoots the panel's bottom edge and gets absorbed; on collapse it
// trails the shrinking panel and melts back into the bar. y = droplet centre, in island px.
const dropEl = $('drop');
function drip(open, from, to) {
  const at = y => `translateY(${y + 20 - 15}px)`; // goo layer starts 20px above the island; drop is 30px
  // more stops and one soft curve, so the drop glides instead of snapping between three points
  const frames = open
    ? [[from - 8, .55, 0], [to * .6, .85, .25], [to + 10, 1, .5], [to - 6, .85, .75], [to - 24, .6, 1]]
    : [[from - 24, .8, 0], [from * .75, .95, .2], [from * .5, 1, .45], [to + 14, .8, .75], [to - 8, .5, 1]];
  document.body.classList.add('gooing');
  dropEl.animate(frames.map(([y, s, offset]) => ({ transform: `${at(y)} scale(${s})`, offset, opacity: 1 })),
    { duration: open ? 640 : 700, easing: 'cubic-bezier(.45,.05,.25,1)' })
    .onfinish = () => document.body.classList.remove('gooing');
}

// a brief hover-intent delay, so passing the cursor over the top edge doesn't pop the panel open
const OPEN_DELAY = 250;
let entering = null;
island.addEventListener('mouseenter', () => {
  window.loupe.hover(true);
  clearTimeout(closing); closing = null;
  if (island.classList.contains('open')) { hovered = true; return; } // still open from the last hover
  entering = setTimeout(() => { entering = null; hovered = true; setOpen(true); }, OPEN_DELAY);
});
island.addEventListener('mouseleave', () => {
  window.loupe.hover(false);
  clearTimeout(entering); entering = null;
  if (!hovered) return; // never opened
  hovered = false;
  clearTimeout(closing);
  closing = setTimeout(() => { closing = null; setOpen(last.some(s => s.state === 'need')); }, closeDelay);
});
window.loupe.onLeave(() => island.dispatchEvent(new MouseEvent('mouseleave'))); // main saw the cursor outside the window
more.addEventListener('click', () => sess.classList.toggle('showterm'));
// Windows: press and drag the island to slide it along its edge (#10). Under 5 px of travel it stays a click.
let dragged = false;
if (!notch) island.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
  const x0 = e.screenX, id = e.pointerId;
  let moving = false;
  const move = ev => {
    const dx = ev.screenX - x0;
    if (!moving && Math.abs(dx) < 5) return;
    if (!moving) { moving = true; island.setPointerCapture(id); window.loupe.drag({ phase: 'start', dx: 0 }); }
    window.loupe.drag({ phase: 'move', dx });
  };
  const up = ev => {
    island.removeEventListener('pointermove', move); island.removeEventListener('pointerup', up); island.removeEventListener('pointercancel', up);
    if (moving) { dragged = true; window.loupe.drag({ phase: 'end', dx: ev.screenX - x0 }); setTimeout(() => { dragged = false; }, 0); }
  };
  island.addEventListener('pointermove', move); island.addEventListener('pointerup', up); island.addEventListener('pointercancel', up);
});
// a click on the open panel (a session row included, which also jumps to it) folds it away. It stays shut until
// the cursor leaves and comes back, since mouseenter only fires again then. A card waiting for an answer keeps it open.
island.addEventListener('click', e => {
  if (dragged) { dragged = false; return; } // the end of a drag, not a click
  if (!island.classList.contains('open') || e.target.closest('button, input, #card, #more, #procs, #upd') ||
    muteEl.parentElement.contains(e.target)) return;
  if (last.some(s => s.ask && !dismissed.has(askKey(s)))) return;
  clearTimeout(closing); closing = null; hovered = false;
  setOpen(false);
});

// Mac: the open panel's glass is a native window behind this one (main.js). Keep it on the island's rect
// while open or morphing. It starts 16px above the screen, so its top corners are off-screen and the top is square.
if (notch) {
  const top = -16, min = +notch.split('x')[1] + 30;
  new ResizeObserver(() => {
    const r = island.getBoundingClientRect();
    const on = island.classList.contains('open') || (morph && morph.playState === 'running');
    window.loupe.glass(on && r.height > min ? { x: r.left, y: top, w: r.width, h: r.height - top } : null);
  }).observe(island);
}

// Mac: main reports where the front app's menus end and the menu bar icons start (window x). When the menus reach
// the left ear, the orb and project slide right through the notch to sit before the verb, shortened to fit before
// the icons; with no room for both, the verb steps aside. Short menus again: they slide back.
if (notch && window.loupe.onMenubar) {
  const mini = island.querySelector('.mini'), side = mini.querySelector('.side'), gap = mini.querySelector('.gap'), orbS = $('orb-s');
  let bar = null;
  const home = () => {
    mini.classList.remove('crowded', 'noverb');
    mini.style.removeProperty('--dx-side'); mini.style.removeProperty('--dx-verb');
    projEl.style.maxWidth = verbEl.style.maxWidth = '';
  };
  const ears = () => {
    if (island.classList.contains('open')) return; // the row is hidden; keep it as it is for when the panel closes
    const mx = mini.getBoundingClientRect().left;
    if (!bar || island.classList.contains('idle') || !projEl.textContent || bar.right <= mx + side.offsetLeft + 2) return home();
    projEl.style.maxWidth = verbEl.style.maxWidth = '';
    mini.classList.remove('noverb');
    const x0 = Math.max(bar.right, mx + gap.offsetLeft + gap.offsetWidth) + 10; // past the menus and the notch
    const room = bar.status - 10 - x0, lead = orbS.offsetWidth + 7;
    const vw = verbEl.offsetWidth; // includes its 10px left padding, the space after the project
    if (lead + projEl.offsetWidth + vw > room) {
      let pmax = room - lead - Math.min(vw, 90);
      if (pmax < 40) { mini.classList.add('noverb'); pmax = room - lead; }
      projEl.style.maxWidth = Math.max(pmax, 0) + 'px';
      if (!mini.classList.contains('noverb')) verbEl.style.maxWidth = Math.max(room - lead - projEl.offsetWidth - 10, 0) + 'px';
    }
    mini.classList.add('crowded');
    mini.style.setProperty('--dx-side', `${x0 - (mx + orbS.offsetLeft)}px`);
    mini.style.setProperty('--dx-verb', `${x0 + lead + projEl.offsetWidth - (mx + verbEl.offsetLeft)}px`);
  };
  window.loupe.onMenubar(m => { bar = m; ears(); });
  window.loupe.onState(() => requestAnimationFrame(ears)); // after render() has set the text
  new MutationObserver(() => requestAnimationFrame(ears)).observe(island, { attributes: true, attributeFilter: ['class'] });
}

// --- Processes (Windows): what Claude sessions left running, from reap.ps1 via main. Off until turned on.
// One line per thread (click to open its rows), "No session" for leftovers of threads that are gone, and one line
// of suggested kills at the bottom: everything thread-less, plus the tasks of threads idle 2 h or more.
// Keep rows (allow.txt) are never suggested. Every kill asks first.
const IDLE_MS = 2 * 3600e3, YOUNG_H = 1 / 60; // rows under a minute old are tool calls still running: not shown
let procsCfg = { ok: false, on: false, asked: true }, procs = null, pview = false, pask = null, review = false, presult = '';
const openG = new Set(), unpicked = new Set();
const procsEl = $('procs'), procrow = $('procrow'), chipEl = $('chip'), updEl = $('upd');
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hrs = h => h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
// a leftover is still in use while under 15 min old, or while its command runs from the folder of a working
// session (a dev server whose launching shell exited): no Kill, never suggested (#16)
const norm = p => String(p).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
// shortcut: the folder only matches when the command names it (a server run by its full path, C:/ or /c/ form);
// Bash tool command lines carry no cwd, so for those the 15 minutes do the work. Upgrade: read each orphan's cwd.
const inFolder = (cmd, cwd) => { const c = norm(cmd), d = norm(cwd); return c.includes(d) || c.includes(d.replace(/^([a-z]):/, '/$1')); };
const inUse = r => Date.now() - Date.parse(r.Started) < 15 * 60e3 ||
  last.some(s => active(s) && s.cwd && inFolder(r.Cmd, s.cwd));
const bgCount = id => procs ? procs.sessions.filter(r => r.sid === id && r.AgeH >= YOUNG_H).length : 0;

function procGroups() {
  if (!procs) return [];
  const by = new Map();
  for (const r of procs.sessions) {
    if (r.AgeH < YOUNG_H) continue;
    const s = last.find(x => x.id === r.sid);
    const key = s ? s.id : '?';
    if (!by.has(key)) by.set(key, {
      key, name: s ? title(s) : 'Unknown thread', rows: [],
      state: !s ? 'work' : active(s) ? 'work' : Date.now() - s.ts >= IDLE_MS ? 'idle' : 'quiet', ts: s ? s.ts : 0,
    });
    by.get(key).rows.push(r);
  }
  const gs = [...by.values()].sort((a, b) => b.ts - a.ts);
  if (procs.leftovers.length) gs.push({ key: '-', name: 'No session', state: 'gone', rows: procs.leftovers.map(r => ({ ...r, inUse: inUse(r) })) });
  return gs;
}
const suggested = gs => gs.flatMap(g => g.state === 'gone' || g.state === 'idle' ? g.rows.filter(r => !r.Allowed && !r.inUse).map(r => ({ r, g })) : []);
const stateWord = g => g.state === 'gone' ? 'closed or archived' : g.state === 'work' ? 'working' : `idle ${ago(g.ts)}`;

function renderProcs() {
  const on = procsCfg.ok && procsCfg.on;
  island.classList.toggle('showupd', procsCfg.ok && !procsCfg.asked);
  if (procsCfg.ok && !procsCfg.asked && !updEl.firstChild) updEl.innerHTML = `<div class="tile">
    <div class="q">New: Processes</div>
    <p>Claude sessions can leave dev servers, log tails and watchers running after you are done with them. They hold ports and memory until you restart.</p>
    <p>LOUPE can list them under each thread and point out the ones from threads you have finished. You pick what closes, and nothing closes without your OK.</p>
    <div class="btns"><button class="btn" data-a="later">Not now</button><button class="btn pri" data-a="on">Turn on</button></div></div>`;
  const gs = on ? procGroups() : [], sg = suggested(gs);
  const all = gs.flatMap(g => g.rows), mb = all.reduce((a, r) => a + r.MemMB, 0);
  chipEl.textContent = on && sg.length ? `${sg.length} to kill` : '';
  island.classList.toggle('empty', !last.length && !chipEl.textContent); // no threads but leftovers: stay visible
  island.classList.toggle('hasprocs', on && !!procs);
  procrow.innerHTML = `Processes<span></span>${all.length} · ${mb} MB${sg.length ? ` · ${sg.length} to kill` : ''}`;
  island.classList.toggle('procsview', on && pview);
  if (!on || !pview) return;
  const picked = sg.filter(x => !unpicked.has(x.r.Pid)), pmb = picked.reduce((a, x) => a + x.r.MemMB, 0);
  let h = `<div class="top"><b>Processes</b><span>${all.length} · ${mb} MB</span><span class="sp"></span><button class="ib" data-a="back">Threads</button><button class="ib" data-a="off">Turn off</button></div><div class="tile list">`;
  if (!gs.length) h += '<div class="empty">Nothing running in the background.</div>';
  h += gs.map(g => {
    const open = openG.has(g.key), gm = g.rows.reduce((a, r) => a + r.MemMB, 0);
    return `<div class="grp${open ? ' open' : ''}"><button class="gh ${g.state === 'idle' || g.state === 'quiet' ? 'idle' : g.state === 'gone' ? 'gone' : ''}" data-g="${esc(g.key)}">` +
      `<span class="nm">${esc(g.name)}</span><span class="st">${stateWord(g)}</span><span class="ct">${g.rows.length} · ${gm} MB</span><span class="cv">›</span></button>` +
      (open ? g.rows.map(r => `<div class="p${r.Allowed ? ' keep' : ''}" data-pid="${r.Pid}"><span class="n" data-open="1" title="PID ${r.Pid}">${esc(r.Label || r.Name)}${r.Allowed ? '<span class="tag">keep</span>' : ''}</span>` +
        `<span class="m">${r.Ports ? `:${esc(r.Ports.split(',')[0])} · ` : ''}${r.MemMB} MB · ${hrs(r.AgeH)}</span>${r.inUse ? '<span class="tag">in use</span>' : `<button class="x" data-kill="${r.Pid}">Kill</button>`}` +
        `<div class="cmd">PID ${r.Pid} · ${esc(r.Cmd)}</div></div>`).join('') : '') + '</div>';
  }).join('');
  h += '</div><div class="tile">';
  if (pask) {
    const set = all.filter(r => pask.includes(r.Pid)), m = set.reduce((a, r) => a + r.MemMB, 0);
    h += `<div class="sline"><span class="sum"><b>Kill ${set.length === 1 ? esc(set[0].Label || set[0].Name) : `${set.length} processes`}?</b> ${m} MB, can't be undone</span>` +
      `<button class="btn sm" data-a="no">Cancel</button><button class="btn sm kill" data-a="yes">Kill</button></div>`;
  } else if (presult) {
    h += `<div class="sline"><span class="sum">${esc(presult)}</span></div>`;
  } else if (!sg.length) {
    h += '<div class="sline"><span class="sum">Nothing to kill</span></div>';
  } else {
    if (review) h += sg.map(({ r, g }) => `<div class="s${unpicked.has(r.Pid) ? '' : ' on'}" data-pick="${r.Pid}"><span class="ck"></span>` +
      `<span class="n">${esc(r.Label || r.Name)}</span><span class="why">${g.state === 'gone' ? 'thread gone' : `idle ${ago(g.ts)}`} · ${r.MemMB} MB</span></div>`).join('');
    h += `<div class="sline"><span class="sum"><b>${picked.length} to kill</b> · ${pmb} MB</span><button class="btn sm" data-a="review">${review ? 'Done' : 'Review'}</button>` +
      `<button class="btn sm kill" data-a="kp"${picked.length ? '' : ' disabled'}>Kill ${picked.length}</button></div>`;
  }
  const keep = procsEl.querySelector('.list'), top = keep ? keep.scrollTop : 0;
  procsEl.innerHTML = h + '</div>';
  const list = procsEl.querySelector('.list'); if (list) list.scrollTop = top;
}

window.loupe.onProcs(p => { procs = p; render(last); });
procrow.onclick = e => { e.stopPropagation(); pview = true; presult = ''; window.loupe.procs(); renderProcs(); };
updEl.addEventListener('click', e => {
  e.stopPropagation();
  const a = e.target.closest('[data-a]'); if (!a) return;
  procsCfg.asked = true; updEl.replaceChildren();
  if (a.dataset.a === 'on') { procsCfg.on = true; pview = true; window.loupe.setConfig({ procs: true, procsAsked: true }); }
  else window.loupe.setConfig({ procsAsked: true });
  renderProcs();
});
procsEl.addEventListener('click', async e => {
  e.stopPropagation(); // the re-render detaches e.target, so the island's fold-on-click check can't see it came from here
  const t = e.target.closest('[data-a], [data-g], [data-kill], [data-pick], [data-open]'); if (!t) return;
  const a = t.dataset.a;
  if (a === 'back') pview = false;
  else if (a === 'off') { procsCfg.on = false; pview = false; window.loupe.setConfig({ procs: false, procsAsked: true }); }
  else if (a === 'review') review = !review;
  else if (a === 'no') pask = null;
  else if (a === 'kp') pask = suggested(procGroups()).filter(x => !unpicked.has(x.r.Pid)).map(x => x.r.Pid);
  else if (a === 'yes') {
    const pids = pask; pask = null; review = false; presult = 'Killing…'; renderProcs();
    const rowsNow = procGroups().flatMap(g => g.rows); // pid@start, so a reused PID is never killed
    const out = await window.loupe.kill(pids.map(p => { const r = rowsNow.find(x => x.Pid === p); return r ? `${p}@${r.Started}` : String(p); }));
    const ok = out.filter(l => / killed /.test(l)).length, bad = out.length - ok;
    presult = bad ? `${ok} killed, ${bad} not: ${out.find(l => !/ killed /.test(l))}` : `${ok} killed`;
    setTimeout(() => { presult = ''; renderProcs(); }, 4000);
  }
  else if (t.dataset.g) { const k = t.dataset.g; openG.has(k) ? openG.delete(k) : openG.add(k); }
  else if (t.dataset.kill) pask = [+t.dataset.kill];
  else if (t.dataset.pick) { const p = +t.dataset.pick; unpicked.has(p) ? unpicked.delete(p) : unpicked.add(p); }
  else if (t.dataset.open) t.closest('.p').classList.toggle('open');
  if (!t.dataset.open) renderProcs();
});