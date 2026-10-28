// Writes the LOUPE icon sources: tray.svg (three dots, tight crop, transparent) and app.svg (on a black tile).
// export-icons.sh renders them to PNG and the installer icon.
import { writeFileSync } from 'fs';

const FG = '#ececec', CY = '#5fc3d3';
const dots = (cx, cy, gap, r) => [FG, CY, FG].map((c, i) => `<circle cx="${cx + (i - 1) * gap}" cy="${cy}" r="${r}" fill="${c}"/>`).join('');

writeFileSync(new URL('tray.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${dots(16, 16, 11, 4.6)}</svg>`);
writeFileSync(new URL('app.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#0b0b0d"/>${dots(128, 128, 52, 20)}</svg>`);
console.log('ok');
