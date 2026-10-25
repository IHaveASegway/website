import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { hex, themeColors } from '../src/lib/tokens';
import { html, read } from './support/dist';
import { attribute, elementsOf, type Element } from './support/html';

// The browser chrome (design-system.md, "Theme before first paint"): every page carries one
// theme-color meta per OS scheme, each the background token of its theme, read here from
// tokens.css itself, so a palette change cannot leave the bar above the page a color the page no
// longer has. The metas come before the theme script, which repoints them for a stored theme, so
// it finds them before the first paint; e2e/theme.spec.ts checks that in a browser.

const DARK = '(prefers-color-scheme: dark)';
const LIGHT = '(prefers-color-scheme: light)';
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const background = (theme: 'dark' | 'light') => {
  const color = themeColors(tokens, theme).get('background');
  if (!color) throw new Error(`tokens.css has no --background in the ${theme} theme`);
  return hex(color);
};
/** [media, content] of each meta, in the order the page must write them. */
type Metas = readonly (readonly [string, string])[];
const EXPECTED: Metas = [
  [DARK, background('dark')],
  [LIGHT, background('light')],
];

/** Why a page's theme-color metas are not the expected ones, one line per problem. */
export function themeColorProblems(page: string, expected: Metas): string[] {
  const elements = elementsOf(page);
  const first = (match: (element: Element) => boolean) => elements.findIndex(match);
  const metas = elements.filter(
    (e) => e.tagName === 'meta' && attribute(e, 'name')?.toLowerCase() === 'theme-color',
  );
  const problems: string[] = [];
  const found = metas.map((m) => [attribute(m, 'media') ?? '', attribute(m, 'content') ?? '']);
  if (JSON.stringify(found) !== JSON.stringify(expected))
    problems.push(`theme-color metas ${JSON.stringify(found)}, not ${JSON.stringify(expected)}`);
  const scheme = first((e) => e.tagName === 'meta' && attribute(e, 'name') === 'color-scheme');
  const script = first((e) => e.tagName === 'script' && e.attrs.length === 0);
  const head = elements.find((e) => e.tagName === 'head');
  for (const meta of metas) {
    const at = elements.indexOf(meta);
    if (meta.parentNode !== head) problems.push('a theme-color meta outside <head>');
    if (scheme < 0 || at < scheme) problems.push('a theme-color meta before the color-scheme meta');
    if (script < 0 || at > script) problems.push('a theme-color meta after the theme script');
  }
  return problems;
}

test("the expected colors are the two themes' backgrounds, and they differ", () => {
  for (const [, color] of EXPECTED) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  expect(background('dark')).not.toBe(background('light'));
});

describe('every page names the background token as its theme-color, per theme', () => {
  for (const file of html) {
    test(file, () => expect(themeColorProblems(read(file), EXPECTED)).toEqual([]));
  }
});

describe('known answers: a wrong color, a missing scheme or a meta after the script is named', () => {
  const page = (metas: string, order: 'before' | 'after' = 'before') => {
    const script = '<script>/* theme */</script>';
    const head = order === 'before' ? metas + script : script + metas;
    return `<!doctype html><html><head><meta name="color-scheme" content="dark light">${head}</head><body></body></html>`;
  };
  const meta = (media: string, content: string) =>
    `<meta name="theme-color" media="${media}" content="${content}">`;
  const SAMPLE: Metas = [
    [DARK, '#000000'],
    [LIGHT, '#ffffff'],
  ];
  const both = meta(DARK, '#000000') + meta(LIGHT, '#ffffff');

  test('the right metas in the right place pass', () => {
    expect(themeColorProblems(page(both), SAMPLE)).toEqual([]);
  });
  test('a color that is not the token fails', () => {
    const wrong = meta(DARK, '#000000') + meta(LIGHT, '#fffffe');
    expect(themeColorProblems(page(wrong), SAMPLE)).toHaveLength(1);
  });
  test('the schemes swapped, one scheme alone, or none, fails', () => {
    const swapped = meta(LIGHT, '#ffffff') + meta(DARK, '#000000');
    expect(themeColorProblems(page(swapped), SAMPLE)).toHaveLength(1);
    expect(themeColorProblems(page(meta(DARK, '#000000')), SAMPLE)).toHaveLength(1);
    expect(themeColorProblems(page(''), SAMPLE)).toHaveLength(1);
  });
  test('a meta the theme script cannot see before the first paint fails', () => {
    expect(themeColorProblems(page(both, 'after'), SAMPLE)).toEqual([
      'a theme-color meta after the theme script',
      'a theme-color meta after the theme script',
    ]);
  });
});
