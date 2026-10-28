import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { aboutBuilt, aboutRoutes } from '../src/lib/about';
import { dist, files, read } from './support/dist';

// /about/ (lib/about.ts): Joseph's words, so a draft until he turns the flag off. A build with
// drafts writes it, linked from nowhere; production writes it only once it is published.

test('known answers: when a build writes /about/, and when the nav links it', () => {
  expect(aboutBuilt(null, true)).toBe(false);
  expect(aboutBuilt({ draft: true }, false)).toBe(false);
  expect(aboutBuilt({ draft: true }, true)).toBe(true);
  expect(aboutBuilt({ draft: false }, false)).toBe(true);
  expect(aboutRoutes(null)).toEqual([]);
  expect(aboutRoutes({ draft: true })).toEqual([]);
  expect(aboutRoutes({ draft: false })).toEqual(['/about/']);
});

const entry = readFileSync(join(import.meta.dirname, '../src/content/about.md'), 'utf8');
const draft = /^draft: true$/m.test(entry);
const page = files.includes('about/index.html') ? read('about/index.html') : null;

test('this build writes /about/ exactly when its entry says, and a draft is marked and noindex', () => {
  const previewBuild = dist.endsWith('dist-preview');
  if (draft && !previewBuild) expect(page, 'a draft bio in a production build').toBeNull();
  if (page === null) return;
  expect(page).toContain('<title>About · ');
  expect(files).toContain('about/og.png');
  if (draft) {
    expect(page).toMatch(/<p class="label">Draft · /);
    expect(page).toMatch(/<meta name="robots" content="noindex/);
  }
  // The bio links the record it replaces in the header.
  expect(page).toContain('href="/resume/"');
});
