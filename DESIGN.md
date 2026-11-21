# DESIGN.md

## Direction (locked 2026-11-20; change only with Julian's yes)
- **Subject:** A black island at the top of my main display that mirrors live Claude Code sessions, approvals and questions. Glanceable, never takes focus. Little text, straight to the point.
- **Palette (60/30/10):**
  - 60% base: `#101114` island (opacity .34 idle, .58 working, .93 open; `#000` in the Mac notch, `#050506` docked)
  - 30% support: `#151517` tile, `#26262a` line
  - 10% accent: `#5fc3d3` cold cyan, only for needs-you and the primary button (hover `#79d3e0`, ink on it `#061214`)
  - Text `#ececec`, muted `#8b8b91`, faint `#77777e`, danger `#9a4a4a` (deny and errors, added 2026-11-20).
- **Type:** Segoe UI Variable 13/1.4 body (system-ui / -apple-system in the notch); row names 12.5/500; questions 13.5/500 at 1.35. Cascadia Mono 10 to 12 for code and meta, as one `--mono` variable.
- **Layout:** Open panel 404 px. Bottom corners 16 collapsed, 18 open; tile 14; rows and options 9; code 8; pills 999. Session grid 2 columns, gap 2. No borders, no shadows, no backdrop blur (a transparent window cannot blur the desktop). Gooey SVG filter on the orb.
- **Motion:** Web Animations plus a canvas orb at 30 fps. Ease `cubic-bezier(.32,.72,0,1)`. Panel open 520 ms, close 440 ms; content fades in 420 ms after 110 ms from translateY(-4px) scale(.98), fades out 120 ms first on close. Goo drop 640/700 ms. Reduced motion: orb still, fold snaps, panel morph skipped.
- **References:**
  - `mock.html`, `mock-dock.html`, `orb-mock.html`.
  - thinking-orbs (MIT): the dotted orb.
- **Never:** Long text. A second accent. Glow. Cyan for anything other than needs-you and the primary action. Taking focus.

## Tokens
CSS custom properties that match the direction. Mocks and the app both use these.

```css
:root{ /* index.html */
  --tile:#151517; --line:#26262a;
  --fg:#ececec; --dim:#8b8b91; --faint:#77777e;
  --accent:#5fc3d3; --accent-hover:#79d3e0; --accent-ink:#061214;
  --danger:#9a4a4a;
  --sans:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;
  --mono:"Cascadia Mono",Consolas,ui-monospace,Menlo,monospace;
  --ease:cubic-bezier(.32,.72,0,1);
}
```

## Standing checks
One line each, checked on every mock and build:
- Tap targets at least 44 px; text contrast at least 4.5:1.
- No em dashes in any copy.
- Mono is hard-coded about 12 times in index.html; move it to `--mono` when next touched.
- Check Windows and the Mac notch.
