/* ---------- icons: inlined Lucide subset (src/00-icons.js), rendered to inline svg ---------- */
import { ICONS } from 'virtual:icons';
import { esc } from './utils.js';
import { safeColor } from './safe.js';

export const _icCache = {};
const DEFAULT_ICON = '<rect x="5" y="5" width="14" height="14" rx="3"/>';
/* Icon names can come from stored data (project and team icons). Only the bundled icons resolve; anything else,
   including "constructor" or markup, gets the default glyph. */
export function ic(name, size = 16, cls = '') {
  const known = typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, name);
  const px = Number(size) || 16;
  const k = (known ? name : '') + '|' + px + '|' + cls;
  if (_icCache[k]) return _icCache[k];
  const inner = known ? ICONS[name] : DEFAULT_ICON;
  return (_icCache[k] =
    `<svg class="i ${esc(cls)}" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`);
}
/* PM Space brand. The wordmark is plain text in the app's own font, in the theme's text colour, in a box h px tall. It is HTML rather than svg
   because the width of text depends on the font, which loads late: an svg would have to guess its width and could clip or leave a gap.
   The app mark is a white "PM" on a black tile, the same tile and the same paths as public/favicon.svg. Unlike the wordmark it is drawn as
   outlines (Geist SemiBold, 600), not text: a favicon is shown without the web font, and a fallback font's letters had to be squeezed into the
   tile with textLength, which distorted them. Outlines look the same wherever the mark is drawn. */
export const LOGO = (h = 22) =>
  `<span class="logo" role="img" aria-label="PM Space" style="height:${h}px;line-height:${h}px;font-size:${Math.max(10, Math.round(h * 7.5) / 10)}px">PM Space</span>`;
export const MARK = (px = 22) =>
  `<svg width="${px}" height="${px}" viewBox="0 0 332 332" aria-hidden="true"><rect width="332" height="332" fill="#000"/><path fill="#fff" d="M55.1 222.8V109.2H99.1Q119 109.2 130.2 118.8Q141.5 128.4 141.5 145.4Q141.5 162.5 130.2 172.2Q119 181.8 99.1 181.8H75.9V222.8ZM75.9 163.8H98.2Q108.7 163.8 114.4 159.1Q120.1 154.5 120.1 145.4Q120.1 136.4 114.4 131.8Q108.7 127.3 98.2 127.3H75.9ZM158.2 222.8V109.2H186.2L217.5 197.2L248.9 109.2H276.9V222.8H256.1V144.4L227.4 222.6H207.6L179 144.4V222.8Z"/></svg>`;
export function wsLogo(w, px = 22) {
  return w && w.brand
    ? `<span class="ws-logo brand" style="width:${px}px;height:${px}px">${MARK(px)}</span>`
    : `<span class="ws-logo" style="--c:${safeColor(w?.c)};width:${px}px;height:${px}px;font-size:${Math.max(9, Math.round(px * 0.46))}px">${esc(String(w?.name ?? '')[0])}</span>`;
}
