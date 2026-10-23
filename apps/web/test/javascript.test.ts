import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// PR 2 ships no JavaScript at all: every page is complete as HTML and CSS. PR 3 replaces this
// with the eager-JS budget, 5 KB gzip per content page (design-system.md, "Budgets").

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('the build contains no script: no <script> element and no JavaScript file', () => {
  const files = walk(dist);
  const scripts = files
    .filter((path) => /\.(m?js|cjs)$/.test(path))
    .map((path) => relative(dist, path));
  const pages = files
    .filter((path) => path.endsWith('.html'))
    .filter((path) => /<script\b/i.test(readFileSync(path, 'utf8')))
    .map((path) => relative(dist, path));
  expect({ scripts, pages }).toEqual({ scripts: [], pages: [] });
});
