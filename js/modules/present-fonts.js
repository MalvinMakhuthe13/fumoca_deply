/**
 * Fonts for posters, magazine covers and newspapers.
 *
 *  • A curated library loaded on demand from Google Fonts: editorial serifs,
 *    newspaper blackletter, typewriter, condensed display, and street /
 *    graffiti / spray-paint faces.
 *  • Your own fonts: upload a .ttf / .otf / .woff / .woff2 and it is used
 *    right away, saved with the asset (so the published page shows it too).
 */

export const FONT_LIBRARY = [
  // group, family, css stack, google family spec ('' = system font)
  ['Editorial', 'Playfair Display', '"Playfair Display", Georgia, serif', 'Playfair+Display:wght@400;700;900'],
  ['Editorial', 'Cormorant Garamond', '"Cormorant Garamond", Georgia, serif', 'Cormorant+Garamond:wght@400;600;700'],
  ['Editorial', 'Abril Fatface', '"Abril Fatface", Georgia, serif', 'Abril+Fatface'],
  ['Editorial', 'DM Serif Display', '"DM Serif Display", Georgia, serif', 'DM+Serif+Display'],
  ['Newspaper', 'UnifrakturMaguntia (blackletter masthead)', '"UnifrakturMaguntia", "Old English Text MT", serif', 'UnifrakturMaguntia'],
  ['Newspaper', 'Old Standard TT', '"Old Standard TT", "Times New Roman", serif', 'Old+Standard+TT:wght@400;700'],
  ['Newspaper', 'Libre Baskerville', '"Libre Baskerville", Georgia, serif', 'Libre+Baskerville:wght@400;700'],
  ['Newspaper', 'Special Elite (typewriter)', '"Special Elite", "Courier New", monospace', 'Special+Elite'],
  ['Newspaper', 'Times New Roman', '"Times New Roman", Times, serif', ''],
  ['Display', 'Bebas Neue', '"Bebas Neue", Impact, sans-serif', 'Bebas+Neue'],
  ['Display', 'Anton', 'Anton, Impact, sans-serif', 'Anton'],
  ['Display', 'Oswald', 'Oswald, Impact, sans-serif', 'Oswald:wght@400;600;700'],
  ['Display', 'Monoton', 'Monoton, Impact, sans-serif', 'Monoton'],
  ['Display', 'Shrikhand', 'Shrikhand, Georgia, serif', 'Shrikhand'],
  ['Street & graffiti', 'Permanent Marker', '"Permanent Marker", cursive', 'Permanent+Marker'],
  ['Street & graffiti', 'Rubik Spray Paint', '"Rubik Spray Paint", Impact, sans-serif', 'Rubik+Spray+Paint'],
  ['Street & graffiti', 'Sedgwick Ave Display', '"Sedgwick Ave Display", cursive', 'Sedgwick+Ave+Display'],
  ['Street & graffiti', 'Rock Salt', '"Rock Salt", cursive', 'Rock+Salt'],
  ['Street & graffiti', 'Bangers', 'Bangers, Impact, sans-serif', 'Bangers'],
  ['Street & graffiti', 'Black Ops One (stencil)', '"Black Ops One", Impact, sans-serif', 'Black+Ops+One'],
  ['Street & graffiti', 'Rubik Glitch', '"Rubik Glitch", Impact, sans-serif', 'Rubik+Glitch'],
  ['Street & graffiti', 'Faster One', '"Faster One", Impact, sans-serif', 'Faster+One'],
  ['Script', 'Pacifico', 'Pacifico, cursive', 'Pacifico'],
  ['Script', 'Lobster', 'Lobster, cursive', 'Lobster'],
  ['Script', 'Caveat (handwriting)', 'Caveat, cursive', 'Caveat:wght@400;700'],
  ['Clean', 'DM Sans', '"DM Sans", system-ui, sans-serif', 'DM+Sans:wght@400;500;700;800'],
  ['Clean', 'Space Grotesk', '"Space Grotesk", system-ui, sans-serif', 'Space+Grotesk:wght@400;600;700'],
  ['Clean', 'Inter', 'Inter, system-ui, sans-serif', 'Inter:wght@400;600;800'],
  ['Clean', 'IBM Plex Mono', '"IBM Plex Mono", monospace', 'IBM+Plex+Mono:wght@400;600'],
  ['Clean', 'Arial', 'Arial, Helvetica, sans-serif', ''],
  ['Clean', 'Georgia', 'Georgia, serif', ''],
];

const MAX_FONT_BYTES = 2.5 * 1024 * 1024, MAX_FONTS = 6;
const loadedGoogle = new Set();
let custom = [];   // [{ name, dataUrl }]

const firstFamily = (stack) => String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '');

/** Load a library font's stylesheet once (no-op for system fonts and uploads). */
export function ensureFont(stack) {
  const fam = firstFamily(stack);
  if (!fam || typeof document === 'undefined' || !document.head?.appendChild || !document.createElement) return;
  const entry = FONT_LIBRARY.find(f => firstFamily(f[2]) === fam);
  if (!entry || !entry[3] || loadedGoogle.has(entry[3])) return;
  loadedGoogle.add(entry[3]);
  let link;
  try { link = document.createElement('link'); } catch (_) { return; }
  if (!link) return;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${entry[3]}&display=swap`;
  try { if (link.dataset) link.dataset.fumocaFont = fam; document.head.appendChild(link); } catch (_) {}
}

/** Make sure every font used by these text items is available. */
export function ensureFontsFor(items = []) { for (const it of items) if (it?.fontFamily) ensureFont(it.fontFamily); }

const safeName = (n) => String(n || 'My font').replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[^\w \-]/g, '').trim().slice(0, 48) || 'My font';

async function register(name, dataUrl) {
  if (typeof FontFace === 'undefined') return false;
  try {
    const face = new FontFace(name, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (e) { console.warn('[fonts] could not load', name, e); return false; }
}

/** Upload a font file. Returns its CSS stack, or throws a friendly error. */
export async function addFontFile(file) {
  if (!file) throw new Error('Choose a font file.');
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Use a .ttf, .otf, .woff or .woff2 font file.');
  if (file.size > MAX_FONT_BYTES) throw new Error('That font is over 2.5 MB — try the .woff2 version.');
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the font file.')); r.readAsDataURL(file); });
  let name = safeName(file.name), k = 2;
  while (custom.some(f => f.name === name)) name = `${safeName(file.name)} ${k++}`;
  if (!(await register(name, dataUrl))) throw new Error('This browser could not read that font file.');
  custom = [...custom, { name, dataUrl }].slice(-MAX_FONTS);
  window.dispatchEvent(new CustomEvent('fumoca:fontsChange'));
  return `"${name}", sans-serif`;
}

export function removeFont(name) {
  custom = custom.filter(f => f.name !== name);
  window.dispatchEvent(new CustomEvent('fumoca:fontsChange'));
}

/** Saved with the asset (meta.present.fonts). */
export function getCustomFonts() { return custom.map(f => ({ ...f })); }

/** Restore uploaded fonts (Studio reload or the published viewer). */
export async function restoreFonts(list) {
  const ok = (Array.isArray(list) ? list : []).filter(f => f && typeof f.name === 'string' && /^data:(font|application)\/[\w.+-]+;base64,/i.test(String(f.dataUrl || '')) && f.dataUrl.length < MAX_FONT_BYTES * 1.4).slice(0, MAX_FONTS);
  custom = ok.map(f => ({ name: safeName(f.name), dataUrl: f.dataUrl }));
  await Promise.all(custom.map(f => register(f.name, f.dataUrl)));
  window.dispatchEvent(new CustomEvent('fumoca:fontsChange'));
}

/** Options for a <select>: library groups + uploads. */
export function fontOptions(selected = '') {
  const groups = {};
  for (const [g, label, stack] of FONT_LIBRARY) (groups[g] ||= []).push([stack, label]);
  if (custom.length) groups['Your fonts'] = custom.map(f => [`"${f.name}", sans-serif`, f.name]);
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const known = Object.values(groups).flat().some(([v]) => v === selected);
  let html = known || !selected ? '' : `<option value="${esc(selected)}" selected>${esc(firstFamily(selected))}</option>`;
  for (const [g, list] of Object.entries(groups)) html += `<optgroup label="${esc(g)}">` + list.map(([v, l]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`).join('') + '</optgroup>';
  return html;
}

const api = { FONT_LIBRARY, ensureFont, ensureFontsFor, addFontFile, removeFont, getCustomFonts, restoreFonts, fontOptions };
if (typeof window !== 'undefined') window.FumocaFonts = api;
export default api;
