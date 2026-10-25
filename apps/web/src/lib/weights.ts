import { gzipSync } from 'node:zlib';
import themeSource from '../scripts/theme.js?raw';

// How a page's bytes are measured has one owner: this module. test/budgets.test.ts reads every page
// of every build through it against the budgets (design-system.md, "Budgets as CI fitness
// functions"), and Base.astro takes the theme script from it. No page prints a figure about itself.

/** Bytes after gzip -9: the unit of the JavaScript and CSS budgets (design-system.md, "Budgets"). */
export function gzipBytes(data: string | Uint8Array): number {
  return gzipSync(data, { level: 9 }).byteLength;
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

/** Every font file the @font-face rules a page carries inline name, once each: every face it can
 *  fetch, preloaded or not (the Fonts API writes its @font-face into the page). */
export function declaredFonts(html: string): string[] {
  const sources = pageStyles(html).inline.flatMap((css) =>
    [...css.matchAll(/@font-face\s*\{[^}]*?\bsrc\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(
      ([, src = '']) => src,
    ),
  );
  return [...new Set(sources)];
}

/** The theme script exactly as Base.astro inlines it and astro.config.mjs hashes it. */
export const THEME_SCRIPT: string = themeSource;
