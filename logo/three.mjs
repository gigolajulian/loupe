// THREE: refinements of the three-dot LOUPE mark. Writes logo/three-*.svg and logo/sheet3.html.
import { writeFileSync } from 'fs';

const FG = '#ececec', CY = '#5fc3d3';
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
const dot = (x, y, r, c = FG, a = 1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"${a < 1 ? ` fill-opacity="${a}"` : ''}/>`;

const MARKS = {
  even:  svg(dot(17, 32, 5) + dot(32, 32, 5, CY) + dot(47, 32, 5)),            // the original, filling the frame
  depth: svg(dot(16, 32, 3.6) + dot(32, 32, 6.4, CY) + dot(48, 32, 3.6)),        // centre forward, like the orb's front dot
  orbit: svg(dot(14, 34, 3.2, FG, .55) + dot(32, 32, 6, CY) + dot(50, 30, 4.4)), // one dot behind, one in front: a tilted orbit
  stack: svg(dot(32, 15, 5) + dot(32, 32, 5, CY) + dot(32, 49, 5)),             // vertical, for a tall slot
};
for (const [k, s] of Object.entries(MARKS)) writeFileSync(new URL(`three-${k}.svg`, import.meta.url), s);

const tile = (k, s, bg) => `<div class="tile" style="background:${bg}"><div class="big">${s}</div>
  <div class="small"><div style="width:32px">${s}</div><div style="width:16px">${s}</div></div><div class="name">${k}</div></div>`;
const tiles = Object.entries(MARKS).map(([k, s]) => tile(k, s, '#0d0d0f')).join('');
writeFileSync(new URL('sheet3.html', import.meta.url), `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#070708;color:#ececec;font:12px "Cascadia Mono",Consolas,monospace;padding:28px}
.grid{display:grid;grid-template-columns:repeat(4,230px);gap:12px}.tile{border:1px solid #1c1c1f;height:300px;display:grid;grid-template-rows:1fr auto auto}
.big{display:grid;place-items:center}.big svg{width:170px}.small{display:flex;gap:18px;align-items:center;justify-content:center;padding:12px 0;border-top:1px solid #1c1c1f}
.name{padding:9px 12px;border-top:1px solid #1c1c1f}</style><div class="grid">${tiles}</div>`);
console.log('ok');
