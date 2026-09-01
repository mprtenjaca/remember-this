// Brand assets for Remember This — one glyph, four outputs.
//
// The glyph is the "I3" bulb-with-rays from the logo sheet (2026-08-28), drawn once in a 64×64 box. Everything
// else is placement: the app icon puts it dark on lime, the Android adaptive foreground puts it alone on
// transparent (the lime ground comes from app.json), the splash is the "C2" stacked lockup with the wordmark in
// Manrope 700, and the favicon is the icon with rounded corners because the web has no mask of its own.
//
// Run:  npm run brand   (from the repo root)   — writes assets/brand/*.svg and assets/*.png
//
// Colours are the app's own tokens (src/ui/theme/tokens.ts): accent #D7EC7C, onAccent #14160E. They are written
// as literals here because resvg has no CSS variables — keep them in sync by hand if the palette ever moves.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const brandDir = join(root, 'assets', 'brand');
const assetsDir = join(root, 'assets');
const manropeBold = join(root, 'node_modules', '@expo-google-fonts', 'manrope', '700Bold', 'Manrope_700Bold.ttf');

const LIME = '#D7EC7C';
const INK = '#14160E';

/**
 * The bulb with rays, in a 64×64 box (visual bbox x 16.5–47.5, y 3–60.8 — centred on x=32, y≈32).
 * `ink` paints the bulb, `ground` paints the filament dot so the negative space matches whatever it sits on;
 * on a transparent canvas the dot is simply cut out.
 */
function glyph(ink, ground) {
  const dot = ground === 'none' ? '' : `<circle cx="32" cy="28" r="3" fill="${ground}"/>`;
  return `
    <g fill="${ink}">
      <path d="M32 3v5 M16.5 10.5l3.4 3.4 M47.5 10.5l-3.4 3.4" stroke="${ink}" stroke-width="4.2" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="27" r="13"/>
      <path d="M25.6 38.6h12.8l-1.8 8.6H27.4z"/>
      <rect x="26.4" y="50" width="11.2" height="4.4" rx="2.2"/>
      <rect x="28.4" y="56.4" width="7.2" height="4.4" rx="2.2"/>
      ${dot}
    </g>`;
}

/** Place the 64-unit glyph so its box is `size` px wide, centred at (cx, cy). */
function placed(ink, ground, size, cx, cy) {
  const s = size / 64;
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})">${glyph(ink, ground)}</g>`;
}

// On the logo sheet the app icon shows the glyph box at 62/108 = 57 % of the tile. Keep that ratio.
const ICON_RATIO = 62 / 108;

/** iOS / store icon: 1024², lime, square (the OS applies its own mask). */
function iconSvg() {
  const S = 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" fill="${LIME}"/>
  ${placed(INK, LIME, S * ICON_RATIO, S / 2, S / 2)}
</svg>`;
}

/**
 * Android adaptive foreground: 1024², transparent. Launchers show only the inner 72/108 (66 %) of the canvas,
 * so the glyph is sized to 57 % of THAT, which makes it appear the same size as on iOS. Background colour
 * comes from app.json (`adaptiveIcon.backgroundColor`).
 */
function adaptiveSvg() {
  const S = 1024;
  const safe = S * (72 / 108);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  ${placed(INK, 'none', safe * ICON_RATIO, S / 2, S / 2)}
</svg>`;
}

/**
 * Splash: the C2 stacked lockup — glyph above "Remember This", Manrope 700, normal case, tracking −0.03em.
 * Proportions from the sheet: icon 66 · gap 16 · type 30. Transparent canvas; the lime ground is the splash
 * backgroundColor in app.json. Displayed at `imageWidth` dp, so the wordmark sets the width.
 */
function splashSvg() {
  const W = 1024;
  const H = 640;
  const type = 112;
  const icon = type * (66 / 30);
  const gap = type * (16 / 30);
  // Total stack height ≈ icon + gap + cap height (~0.72 em). Centre the stack vertically.
  const stackH = icon + gap + type * 0.72;
  const top = (H - stackH) / 2;
  const iconCy = top + icon / 2;
  const baseline = top + icon + gap + type * 0.72;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${placed(INK, 'none', icon, W / 2, iconCy)}
  <text x="${W / 2}" y="${baseline}" text-anchor="middle" font-family="Manrope" font-weight="700" font-size="${type}" letter-spacing="${(-0.03 * type).toFixed(2)}" fill="${INK}">Remember This</text>
</svg>`;
}

/**
 * Android notification icon: 96², WHITE glyph on transparent. Android masks this to a silhouette — any colour is
 * discarded and anything non-transparent becomes solid white, so the filament dot must be a real hole, not a
 * painted circle, or the bulb turns into a blob in the status bar.
 */
function notificationSvg() {
  const S = 96;
  const safe = S * 0.75; // Android insets the icon itself; leave it room
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  ${placed('#FFFFFF', 'none', safe, S / 2, S / 2)}
</svg>`;
}

/** Web favicon: the icon, with the corner radius the OS would otherwise apply. */
function faviconSvg() {
  const S = 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" rx="${S * 0.22}" fill="${LIME}"/>
  ${placed(INK, LIME, S * ICON_RATIO, S / 2, S / 2)}
</svg>`;
}

function render(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [manropeBold], loadSystemFonts: false, defaultFontFamily: 'Manrope' },
  });
  return r.render().asPng();
}

const jobs = [
  { name: 'icon', svg: iconSvg(), png: 'icon.png', width: 1024 },
  { name: 'adaptive-icon', svg: adaptiveSvg(), png: 'adaptive-icon.png', width: 1024 },
  { name: 'splash-icon', svg: splashSvg(), png: 'splash-icon.png', width: 1024 },
  { name: 'favicon', svg: faviconSvg(), png: 'favicon.png', width: 64 },
  { name: 'notification-icon', svg: notificationSvg(), png: 'notification-icon.png', width: 96 },
];

mkdirSync(brandDir, { recursive: true });
readFileSync(manropeBold); // fail loudly if the font is missing (npm install not run)
for (const j of jobs) {
  writeFileSync(join(brandDir, `${j.name}.svg`), j.svg);
  const png = render(j.svg, j.width);
  writeFileSync(join(assetsDir, j.png), png);
  console.log(`${j.png.padEnd(18)} ${String(png.length).padStart(7)} B  ← brand/${j.name}.svg`);
}
