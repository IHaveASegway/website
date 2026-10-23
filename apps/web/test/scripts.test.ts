import { describe, expect, test } from 'vitest';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read } from './support/dist';

// The script allowlist (spec B13): a page may carry the inline theme script, exactly as
// src/scripts/theme.js has it and first in <body>, and JSON-LD. Anything else fails, whatever
// wrote it: a component, an integration, a dependency. The Web Analytics beacon joins the list in
// the pull request that ships it.

type Verdict = 'theme' | 'json-ld' | string;

export function classify(script: {
  attributes: Readonly<Record<string, string>>;
  body: string;
}): Verdict {
  const names = Object.keys(script.attributes).sort().join(' ');
  if (names === '' && script.body === THEME_SCRIPT) return 'theme';
  if (names === 'type' && script.attributes['type'] === 'application/ld+json') return 'json-ld';
  return `not allowed: <script ${names}> ${script.body.slice(0, 60)}`;
}

for (const file of html) {
  describe(file, () => {
    const page = read(file);
    const verdicts = tags(page, 'script').map(classify);

    test('every script is the theme script or JSON-LD', () => {
      expect(verdicts.filter((v) => v !== 'theme' && v !== 'json-ld')).toEqual([]);
    });

    test('the theme script is there once, as the first child of <body>', () => {
      expect(verdicts.filter((v) => v === 'theme')).toHaveLength(1);
      expect(page).toMatch(/<body[^>]*><script>/);
    });

    test('JSON-LD is on Home only', () => {
      expect(verdicts.filter((v) => v === 'json-ld')).toHaveLength(file === 'index.html' ? 1 : 0);
    });
  });
}

test('known answers: a changed byte, an external file or a module is refused', () => {
  expect(classify({ attributes: {}, body: THEME_SCRIPT })).toBe('theme');
  expect(classify({ attributes: {}, body: `${THEME_SCRIPT} ` })).toMatch(/^not allowed/);
  expect(classify({ attributes: { src: '/_astro/x.js' }, body: '' })).toMatch(/^not allowed/);
  expect(classify({ attributes: { type: 'module' }, body: THEME_SCRIPT })).toMatch(/^not allowed/);
  expect(classify({ attributes: { type: 'application/ld+json' }, body: '{}' })).toBe('json-ld');
});
