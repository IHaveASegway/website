import { gzipSync } from 'node:zlib';
import themeSource from '../scripts/theme.js?raw';

// Byte figures have one owner: this module. Home's readouts call it at build time on the inputs
// (the theme script, the font files), and test/budgets.test.ts and test/readouts.test.ts call it on
// dist/, so a printed figure and the measured one cannot drift apart unnoticed (spec B13).

/** Bytes after gzip -9: the unit of the JavaScript and CSS budgets (design-system.md, "Budgets"). */
export function gzipBytes(data: string | Uint8Array): number {
  return gzipSync(data, { level: 9 }).byteLength;
}

/** "0.4 KB": one decimal, and 1 KB is 1,000 B (design-system.md, "Units"). */
export function kilobytes(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} KB`;
}

export interface Tag {
  readonly attributes: Readonly<Record<string, string>>;
  readonly body: string;
}

function attributesOf(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name = '', a, b, c] of source.matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    found[name.toLowerCase()] = a ?? b ?? c ?? '';
  }
  return found;
}

/** Every element of one kind in an HTML document, with its attributes and its text. */
export function tags(html: string, name: 'script' | 'style' | 'link'): Tag[] {
  const pattern =
    name === 'link'
      ? /<link\b([^>]*)>/gi
      : new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi');
  return [...html.matchAll(pattern)].map(([, attributes = '', body = '']) => ({
    attributes: attributesOf(attributes),
    body,
  }));
}

const JAVASCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

/** A script the browser runs; a data block such as application/ld+json is not one. */
export function isJavaScript(script: Tag): boolean {
  return JAVASCRIPT_TYPES.has((script.attributes['type'] ?? '').toLowerCase());
}

/** The scripts a page runs as it loads: inline ones by their text, external ones by their URL. */
export function eagerScripts(html: string): { inline: string[]; external: string[] } {
  const scripts = tags(html, 'script').filter(isJavaScript);
  return {
    inline: scripts.filter((s) => s.attributes['src'] === undefined).map((s) => s.body),
    external: scripts.flatMap((s) =>
      s.attributes['src'] === undefined ? [] : [s.attributes['src']],
    ),
  };
}

/** The stylesheets a page links, and the CSS it carries inline (the Fonts API's @font-face). */
export function pageStyles(html: string): { linked: string[]; inline: string[] } {
  return {
    linked: tags(html, 'link')
      .filter((link) => link.attributes['rel']?.split(/\s+/).includes('stylesheet'))
      .map((link) => link.attributes['href'] ?? ''),
    inline: tags(html, 'style').map((style) => style.body),
  };
}

/** The font files a page preloads. */
export function preloadedFonts(html: string): string[] {
  return tags(html, 'link')
    .filter((link) => link.attributes['rel'] === 'preload' && link.attributes['as'] === 'font')
    .map((link) => link.attributes['href'] ?? '');
}

/** The theme script exactly as Base.astro inlines it and astro.config.mjs hashes it. */
export const THEME_SCRIPT: string = themeSource;

/** At build: the eager JavaScript on a content page. In PR 3 that is the inline theme script
 *  alone, so the figure is exact; with the first bundled module it moves to astro:build:done. */
export function pageJavaScriptBytes(): number {
  return gzipBytes(THEME_SCRIPT);
}

// Every font in src/assets/fonts is preloaded (Base.astro). Inlined as data URLs here only to be
// counted at build: this module never reaches the browser.
const fontFiles = import.meta.glob<string>('../assets/fonts/*.woff2', {
  query: '?inline',
  import: 'default',
  eager: true,
});

/** At build: the bytes of the preloaded font files, as served (woff2 is already compressed). */
export function preloadedFontBytes(): number {
  return Object.values(fontFiles).reduce((sum, dataUrl) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return sum + Buffer.from(base64, 'base64').byteLength;
  }, 0);
}
