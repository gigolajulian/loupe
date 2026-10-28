// One dotted orb (thinking-orbs engine, MIT) shows the most urgent session. The list under it is plain text.
import { resolvePreset, MODE_FRAMES } from './node_modules/thinking-orbs/dist/engine.es.js';

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
const ANIM = { read: 'searching', edit: 'composing', run: 'working' };

function look(s) {
  switch (s && s.state) {
    case 'need': return { anim: 'listening', ink: 'cyan' };
    case 'work': return { anim: ANIM[s.step] || 'working', ink: 'white' };
    case 'think': return { anim: 'breathing', ink: 'white' };
    case 'done': return { anim: 'breathing', ink: 'white', still: true };
    // stopped: the searching globe, frozen and with its scan sweep switched off
    case 'err': return { anim: 'searching', ink: 'white', still: true, opts: { scanMul: 0 } };
    default: return { anim: 'breathing', ink: 'dim', still: true, logo: true }; // nothing going on: the orb folds into the LOUPE mark
  }
}

function verb(s) {
  const d = s.detail || '', f = d.split(/[\/]/).pop();
  switch (s.state) {
    case 'need': return 'needs you';
    case 'think': return 'thinking';
    case 'work':
      if (s.step === 'read') return `reading ${f}`;
      if (s.step === 'edit') return `editing ${f}`;
      if (s.step === 'run') return `running ${d.split(' ')[0]}`;
      return 'working';
    case 'done': return 'done';
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
const t0 = performance.now();
let cur = look(null), rgb = [...INK.dim];
let fold = 1, foldTo = 1; // 0 = orb, 1 = LOUPE mark (three dots, cyan centre, as in logo/icons.mjs)
const MARK = [INK.white, INK.cyan, INK.white];

function draw(c, t) {
  const size = +c.dataset.size;
  const { mode, speed, opts } = resolvePreset(cur.anim, size);
  const f = MODE_FRAMES[mode](size, t * speed, cur.opts ? { ...opts, ...cur.opts } : opts);
  const [r, g, b] = rgb.map(Math.round), ctx = c._ctx;
  const m = fold * fold * (3 - 2 * fold); // smoothstep
  const s = Math.max(0, (m - 0.6) / 0.4); // solid mark fades in over the last 40%
  ctx.setTransform(c._k, 0, 0, c._k, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (m < 1) for (const l of f.lines || []) {
    ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - l.white) * (l.a ?? 1) * (1 - m)})`;
    ctx.lineWidth = l.w;
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
  }
  // each dot slides to the mark dot of its third, left to right, and takes that dot's size and color
  const rank = new Map(f.dots.map((d, i) => [d, i]).sort((a, b) => a[0].x - b[0].x).map(([d], i) => [d, i]));
  for (const d of f.dots) {
    const k = Math.min(2, Math.floor(rank.get(d) * 3 / f.dots.length)), ink = MARK[k];
    const a = (1 - d.white) * (d.a ?? 1);
    const x = d.x + (size / 2 + (k - 1) * size * 0.34 - d.x) * m, y = d.y + (size / 2 - d.y) * m;
    const [cr, cg, cb] = [r, g, b].map((v, i) => Math.round(v + (ink[i] - v) * m));
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * (1 - s)})`;
    ctx.beginPath(); ctx.arc(x, y, d.r + (size * 0.14 - d.r) * m, 0, Math.PI * 2); ctx.fill();
  }
  // stacked translucent dots read muddy, so the last stretch hands over to three solid circles
  if (s > 0) MARK.forEach((ink, k) => {
    ctx.fillStyle = `rgba(${ink.join(',')},${s})`;
    ctx.beginPath(); ctx.arc(size / 2 + (k - 1) * size * 0.34, size / 2, size * 0.14, 0, Math.PI * 2); ctx.fill();
  });
}

// frames run only while the orb moves or its ink is easing; a still orb costs nothing between kicks
let raf = 0, lastDraw = 0;
function frame(now) {
  raf = 0;
  if (now - lastDraw < 30) { raf = requestAnimationFrame(frame); return; } // 30 fps is plenty for a 26 px orb
  lastDraw = now;
  const want = INK[cur.ink];
  rgb = rgb.map((v, i) => v + (want[i] - v) * 0.16); // ink eases to the new color over ~0.5 s at 30 fps
  const settled = rgb.every((v, i) => Math.abs(v - want[i]) < 0.5);
  if (settled) rgb = [...want];
  foldTo = cur.logo ? 1 : 0;
  fold = reduce.matches ? foldTo : fold + Math.sign(foldTo - fold) * Math.min(Math.abs(foldTo - fold), 1 / 18); // ~0.6 s at 30 fps
  const folding = fold !== foldTo;
  const still = (cur.still && !folding) || reduce.matches;
  const t = still ? 2 : (performance.now() - t0) / 1000;
  for (const c of orbs) if (c.offsetParent) draw(c, t); // hidden canvas: skip
  if (!still || !settled || folding) raf = requestAnimationFrame(frame);
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
kick();
reduce.addEventListener('change', kick);

// a session's step in its project, from its title: "JG - QA" -> QA, "Website: booking card" -> booking card
const step = s => {
  const t = (s.title || '').replace(/^[^:-]*?\s(?:-|:)\s+|^[^:]+:\s+/, '');
  return t && t.toUpperCase() !== s.name.toUpperCase() ? t : s.wt || '';
};
const quiet = s => s.state === 'idle' || s.state === 'done';
// QA and RELEASE close the pipeline, every other step comes before them
const stage = l => ({ QA: 1, RELEASE: 2 })[l.toUpperCase()] || 0;

// sessions of one project share a row: the list is sorted, so each group's first is its most urgent
function groups(list) {
  const m = new Map();
  for (const s of list) (m.get(s.name) || m.set(s.name, []).get(s.name)).push(s);
  return [...m.values()];
}

// --- session list: one keyed row per project, reordered in place
function sync(gs) {
  const live = new Set(gs.map(g => g[0].name));
  for (const [k, r] of rows) if (!live.has(k)) { r.remove(); rows.delete(k); }
  gs.forEach((g, i) => {
    const s = g[0];
    let r = rows.get(s.name);
    if (!r) {
      r = document.createElement('div');
      r.innerHTML = '<div class="top"><span class="n"></span><span class="st"></span></div><div class="v"></div>';
      rows.set(s.name, r);
    }
    r.onclick = () => window.loupe.open(s.id);
    const want = i === 0 ? sess.firstChild : rows.get(gs[i - 1][0].name).nextSibling;
    if (r !== want) sess.insertBefore(r, want || more);
    r.className = 'r' + (s.state === 'need' ? ' need' : quiet(s) ? ' quiet' : '') + (g.some(x => x.desktop) ? '' : ' term') + (s.host ? ' go' : '');
    r.querySelector('.n').textContent = s.name;
    r.querySelector('.v').textContent = verb(s);
    const steps = g.filter(step).sort((a, b) => stage(step(a)) - stage(step(b)) || step(a).localeCompare(step(b)));
    r.querySelector('.st').replaceChildren(...steps.flatMap((x, j) => {
      const e = document.createElement('span');
      e.textContent = step(x);
      e.className = x.state === 'need' ? 'need' : quiet(x) ? '' : 'on';
      return j ? [' › ', e] : [e];
    }));
  });
}

// cards closed with the × stay closed for that ask; mirrored asks have no req, so key them by session + arrival
const dismissed = new Set();
const askKey = s => s.ask.req || `${s.id}:${s.ask.at}`;

window.loupe.onState(render);
function render(list) {
  last = list;
  // the open list skips projects where every session is idle
  const gs = groups(list).filter(g => g.some(s => s.state !== 'idle')), app = gs.filter(g => g.some(s => s.desktop));
  const termGs = gs.filter(g => !app.includes(g)), term = termGs.length;

  island.classList.toggle('empty', !list.length);
  island.classList.toggle('idle', !!list[0] && (list[0].state === 'idle' || list[0].state === 'done')); // lighter glass
  const asking = list.filter(s => s.ask && !dismissed.has(askKey(s)));
  if (!closing) setOpen(hovered || asking.length > 0 || list.some(s => s.state === 'need' && !s.ask));

  cur = look(list[0]);
  kick();
  projEl.textContent = list[0] ? [list[0].name, step(list[0])].filter(Boolean).join(' › ') : '';
  verbEl.textContent = list[0] ? verb(list[0]) : '';
  verbEl.classList.toggle('need', cur.ink === 'cyan');

  // nothing running: a compact panel with the last 3 projects and how long they've been idle
  const calm = !gs.length;
  island.classList.toggle('calm', calm);
  sync(calm ? groups(list).slice(0, 3) : [...app.slice(0, 5), ...termGs]);
  more.textContent = term ? `${sess.classList.contains('showterm') ? '−' : '+'}${term} terminal` : '';

  island.classList.toggle('asking', asking.length > 0);
  renderAsk(asking[0], asking.length - 1);
  cues(list);
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
const seen = new Map(); // session id -> last state; a session's first sighting stays silent
function cues(list) {
  for (const s of list) {
    const was = seen.get(s.id);
    if (sound && was && was !== s.state && CUE[s.state]) CUE[s.state]();
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
  askEl.replaceChildren();
  if (!s) return;
  const a = s.ask, send = choice => { shown = null; window.loupe.answer(a.req, choice); };

  const who = el('div', 'who', [s.name, step(s)].filter(Boolean).join(' › '));
  const t = el('span', 't');
  t.innerHTML = `<svg class="i"><use href="#${a.kind === 'question' ? 'ask' : ICON[a.tool] || 'run'}"/></svg>`;
  if (a.kind === 'perm' && !ICON[a.tool]) t.append(a.tool);
  who.append(t, el('span', 'sp'), el('span', 'wait', waiting > 0 ? `+${waiting} waiting` : ''));
  const inApp = el('button', 'link');
  inApp.innerHTML = '<svg class="i" style="width:12px;height:12px"><use href="#out"/></svg>in app';
  inApp.onclick = () => { if (a.req) send('app'); window.loupe.open(s.id); };
  // ×: close the card here. A held ask goes back to Claude Code, which then asks in the thread
  const close = el('button', 'link', '×');
  close.title = 'Dismiss';
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

  // pick, then Submit at the bottom. Held (tray "Answer prompts on LOUPE"): Submit answers here.
  // Mirrored: only the thread can answer, so Submit opens the session there.
  const picks = {};
  const done = () => a.questions.every(q => picks[q.question] && picks[q.question].length);
  const answers = () => Object.fromEntries(a.questions.map(q => [q.question, picks[q.question].join(', ')]));
  const pick = (q, o, b) => {
    const cur = picks[q.question] || [];
    picks[q.question] = !q.multiSelect ? [o.label] : cur.includes(o.label) ? cur.filter(x => x !== o.label) : [...cur, o.label];
    b.parentNode.childNodes.forEach((x, j) => x.classList.toggle('sel', picks[q.question].includes(q.options[j].label)));
    submit.disabled = !done();
  };
  a.questions.forEach(q => {
    askEl.append(el('div', 'q', q.question));
    const row = el('div', 'opts');
    (q.options || []).forEach((o, i) => {
      const rec = /\s*\(Recommended\)\s*$/i.test(o.label);
      const b = el('button', 'opt');
      b.append(el('span', 'k', String(i + 1)), el('span', 'l', o.label.replace(/\s*\(Recommended\)\s*$/i, '')),
        el('span', 'd', o.description || ''), ...(rec ? [el('span', 'rec', 'rec')] : []));
      if (o.description) b.title = o.description;
      b.onclick = () => pick(q, o, b);
      row.append(b);
    });
    askEl.append(row);
  });
  const submit = btn(a.req ? 'Submit' : 'Submit in app', 'pri', () => { if (!done()) return; if (a.req) send(answers()); else window.loupe.open(s.id); });
  submit.disabled = true;
  askEl.append(submit);
}

// --- open / close: the island morphs between its two sizes, content fades in on top
const EASE = 'cubic-bezier(.32,.72,0,1)'; // fast start, long soft settle
let morph = null, fading = null, closeDelay = 300, closing = null;
window.loupe.onConfig(c => {
  closeDelay = c.closeDelay; sound = c.sound;
  document.body.classList.toggle('goo-on', c.goo);
  volEl.value = master.gain.value = c.volume;
  showSound();
});

function setOpen(open) {
  if (island.classList.contains('open') === open && !fading) return;
  if (!open) muteEl.parentElement.classList.remove('show'); // slider starts hidden next time
  if (morph) morph.cancel();
  if (fading) { fading.cancel(); fading = null; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!open && !reduce && island.classList.contains('open')) {
    // closing: let the open content fade out first, then shrink
    fading = island.querySelector('.body').animate(
      [{ opacity: 1 }, { opacity: 0 }], // no blur filter: blurring text every frame stutters
      { duration: 120, easing: 'ease-out', fill: 'forwards' });
    fading.onfinish = () => { fading.cancel(); fading = null; resize(false); };
    return;
  }
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
more.addEventListener('click', () => sess.classList.toggle('showterm'));

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
