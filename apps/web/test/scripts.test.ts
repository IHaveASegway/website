import { describe, expect, test } from 'vitest';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read } from './support/dist';

// The script allowlist (spec B13): a page may carry the inline theme script, exactly as
// src/scripts/theme.js has it and first in <head>, and JSON-LD, which Home and each published post
// carry. Anything else fails, whatever wrote it: a component, an integration, a dependency. The
// Web Analytics beacon joins the list in the pull request that ships it.

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

    test('the theme script is there once, in <head> before any stylesheet, so it runs before <body> exists', () => {
      expect(verdicts.filter((v) => v === 'theme')).toHaveLength(1);
      const head = page.slice(0, page.indexOf('</head>'));
      const script = head.indexOf('<script>');
      expect(script).toBeGreaterThan(0);
      const stylesheet = head.search(/<link\b[^>]*rel="stylesheet"/);
      if (stylesheet >= 0) expect(script).toBeLessThan(stylesheet);
      expect(page.slice(page.indexOf('<body'))).not.toMatch(/<script>(?!\s*\{)/);
    });

    test('JSON-LD is on Home and on published posts only, one block each', () => {
      const post =
        /^(writing|notes)\/[a-z0-9-]+\/index\.html$/.test(file) &&
        !page.includes('<meta name="robots" content="noindex">');
      expect(verdicts.filter((v) => v === 'json-ld')).toHaveLength(
        file === 'index.html' || post ? 1 : 0,
      );
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
