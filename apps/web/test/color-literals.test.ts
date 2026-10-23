import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// No color literal outside tokens.css (design-system.md, "Budgets as CI fitness functions").
// A component with its own literal turns a theme change into a search across every file, and
// the contrast test never sees the value. Tailwind's palette is removed in tokens.css too, so a
// class such as bg-zinc-900 produces nothing at all.

const src = fileURLToPath(new URL('../src/', import.meta.url));
const TOKENS = 'styles/tokens.css';
const CHECKED = /\.(astro|css|ts|tsx|js|mjs|md|mdx|html|svg)$/;

const LITERALS = [
  { name: 'a hex color', pattern: /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi },
  { name: 'a color function', pattern: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('no file under src/ other than tokens.css holds a color literal', () => {
  const found: string[] = [];
  for (const path of walk(src)) {
    const file = relative(src, path).split('\\').join('/');
    if (file === TOKENS || !CHECKED.test(file)) continue;
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const { name, pattern } of LITERALS) {
          for (const match of line.matchAll(pattern))
            found.push(`src/${file}:${index + 1}: ${name} (${match[0]})`);
        }
      });
  }
  expect(found).toEqual([]);
});

test('the check sees a literal when one is there', () => {
  // A known answer: a check that cannot fail proves nothing.
  const samples = ['color: #1a2b3c;', 'fill="#fff"', 'bg-[oklch(0.5_0.1_200)]', 'rgb(0 0 0)'];
  for (const sample of samples) {
    expect(
      LITERALS.some(({ pattern }) => sample.match(pattern)),
      sample,
    ).toBe(true);
  }
  for (const sample of [
    'href="#main"',
    '&#8217;',
    'color-mix(in oklab, var(--primary) 30%, transparent)',
  ]) {
    expect(
      LITERALS.some(({ pattern }) => sample.match(pattern)),
      sample,
    ).toBe(false);
  }
});
