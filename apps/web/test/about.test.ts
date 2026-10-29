import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { aboutSchema } from '../src/lib/about';
import { fixture, read } from './support/dist';

// /about/ (lib/about.ts): the bio, Joseph's words from src/content/about.md, then the résumé, which
// test/resume.test.ts checks. Every build writes the page; the bio is there exactly where its entry
// is, and the fixture builds, Writing's test builds, hold none. The entry holds the review stamp and
// nothing else: the nav names the page, and profile.json states every fact the résumé shows, so no
// fact has a second copy to fall out of date.

const fixtureBuild = fixture?.startsWith('.fixtures/') ?? false;
const page = read('about/index.html');
const entry = readFileSync(join(import.meta.dirname, '../src/content/about.md'), 'utf8');
const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(entry)?.[1] ?? '';
const body = entry.slice(entry.indexOf('\n---\n') + 5);

test('the entry carries the review stamp and no other field', () => {
  const keys = [...frontMatter.matchAll(/^([a-z_]+):/gm)].map(([, key]) => key);
  expect(keys).toEqual(Object.keys(aboutSchema.shape));
  expect(keys).toEqual(['firewall_reviewed']);
});

test('the bio renders exactly where its entry is, under its own heading, before Experience', () => {
  const bio = /<section class="section bio"[\s\S]*?<\/section>/.exec(page)?.[0];
  if (fixtureBuild) {
    expect(bio).toBeUndefined();
    return;
  }
  expect(bio).toBeDefined();
  expect(bio).toMatch(/<h2[^>]*>[\s\S]*?About me[\s\S]*?<\/h2>/);
  // Its first paragraph, the one that prints, as the entry opens.
  const first = body.trim().split('\n\n')[0]?.replace(/'/g, '’') ?? '';
  const shown = /<div class="prose">\s*<p>([\s\S]*?)<\/p>/.exec(bio ?? '')?.[1] ?? '';
  expect(shown.replace(/&#39;|&#x27;/g, "'").replace(/'/g, '’')).toBe(first);
  expect(page.indexOf('class="section bio"')).toBeLessThan(page.indexOf('id="experience-title"'));
});

test('the page has one Print button, and no PDF is written for it', () => {
  expect(page.match(/<button\b[^>]*\bdata-print\b/g)).toHaveLength(1);
  expect(page).not.toMatch(/href="[^"]*\.pdf"/);
});
