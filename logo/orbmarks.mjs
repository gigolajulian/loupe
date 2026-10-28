// Writes orb-derived LOUPE marks as SVGs (logo/orb-*.svg) and a contact sheet (logo/sheet2.html).
// Engine frames are frozen at a chosen time; dot opacity follows the engine's ink the way renderer.js draws it.
import { writeFileSync } from 'fs';
import { resolvePreset, MODE_FRAMES } from '../node_modules/thinking-orbs/dist/engine.es.js';

const FG = '#ececec', CY = '#5fc3d3';
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
const dot = (x, y, r, a = 1, c = FG) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${c}"${a < 1 ? ` fill-opacity="${a.toFixed(2)}"` : ''}/>`;

// a frozen engine frame; scale grows dots a little so they survive small sizes
function frame(state, t, extra = {}, scale = 1.25) {
  const { mode, opts } = resolvePreset(state, 64);
  const f = MODE_FRAMES[mode](64, t, { ...opts, ...extra });
  return f.dots.map(d => dot(d.x, d.y, d.r * scale, (1 - d.white) * (d.a ?? 1) * 1.6 > 1 ? 1 : (1 - d.white) * (d.a ?? 1) * 1.6)).join('');
}
// a plain ring of n dots, optional cyan one at index `cy`
const ring = (n, r, dr, cyI = -1, cxr = 32) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2 - Math.PI / 2;
  return dot(cxr + r * Math.cos(a), 32 + r * Math.sin(a), dr, 1, i === cyI ? CY : FG);
}).join('');
// a ring seen at a tilt: dots shrink and fade toward the back, like the orb's depth
const tilted = (n, r, tilt, cyI = -1) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2;
  const z = Math.sin(a); // -1 back, 1 front
  return dot(32 + r * Math.cos(a), 32 + r * Math.sin(a) * tilt, 1.2 + 1.3 * (z + 1) / 2, .35 + .65 * (z + 1) / 2, i === cyI ? CY : FG);
}).join('');

const MARKS = {
  'ring':     svg(frame('breathing', 2)),
  'globe':    svg(frame('searching', 3, { scanMul: 0 }, 1.1)),
  'orbits':   svg(frame('working', 1.3)),
  'twelve':   svg(ring(12, 22, 2.6, 4)),
  'tilt':     svg(tilted(18, 24, .38, 4)),
  'three':    svg(dot(20, 32, 4.2) + dot(32, 32, 4.2, 1, CY) + dot(44, 32, 4.2)),
};
for (const [k, s] of Object.entries(MARKS)) writeFileSync(new URL(`orb-${k}.svg`, import.meta.url), s);

const tiles = Object.entries(MARKS).map(([k, s]) => `<div class="tile"><div class="big">${s}</div>
  <div class="small"><div style="width:32px">${s}</div><div style="width:16px">${s}</div></div><div class="name">${k}</div></div>`).join('');
writeFileSync(new URL('sheet2.html', import.meta.url), `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#070708;color:#ececec;font:12px "Cascadia Mono",Consolas,monospace;padding:28px}
.grid{display:grid;grid-template-columns:repeat(6,190px);gap:12px}.tile{background:#0d0d0f;border:1px solid #1c1c1f;height:300px;display:grid;grid-template-rows:1fr auto auto}
.big{display:grid;place-items:center}.big svg{width:150px}.small{display:flex;gap:18px;align-items:center;justify-content:center;padding:12px 0;border-top:1px solid #1c1c1f}
.name{padding:9px 12px;border-top:1px solid #1c1c1f}</style><div class="grid">${tiles}</div>`);
console.log('wrote', Object.keys(MARKS).length, 'marks');
