import { describe, expect, test } from 'vitest';
import { isNoindex } from '../src/lib/noindex.mjs';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read } from './support/dist';

// The script allowlist (spec B13): a page may carry the inline theme script, exactly as
// src/scripts/theme.js has it and first in <head>, and JSON-LD, which Home, the résumé and each
// published post carry. Anything else fails, whatever wrote it: a component, an integration, a
// dependency. The Web Analytics beacon joins the list in the pull request that ships it.
//
// One page has a third kind, and only one of it (ADR 0016): the Route Lab, /lab/routes/, loads its
// own module, the bundle Astro builds from its component's script (components/route-lab/boot.ts),
// from /_astro/ and never inline. It shows the demo's controls and loads the rest on first use;
// test/budgets.test.ts holds it to the eager budget every page has.

type Verdict = 'theme' | 'json-ld' | 'route-lab' | string;

/** The one page allowed a module of its own, and the name Astro gives that module's bundle. */
export const ROUTE_LAB = {
  page: 'lab/routes/index.html',
  src: /^\/_astro\/RouteLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
} as const;

export function classify(
  script: {
    attributes: Readonly<Record<string, string>>;
    body: string;
  },
  page = '',
): Verdict {
  const names = Object.keys(script.attributes).sort().join(' ');
  if (names === '' && script.body === THEME_SCRIPT) return 'theme';
  if (names === 'type' && script.attributes['type'] === 'application/ld+json') return 'json-ld';
  if (
    page === ROUTE_LAB.page &&
    names === 'src type' &&
    script.attributes['type'] === 'module' &&
    ROUTE_LAB.src.test(script.attributes['src'] ?? '') &&
    script.body === ''
  )
    return 'route-lab';
  return `not allowed: <script ${names}> ${script.body.slice(0, 60)}`;
}

for (const file of html) {
  describe(file, () => {
    const page = read(file);
    const verdicts = tags(page, 'script').map((script) => classify(script, file));

    test('every script is the theme script or JSON-LD, and on the Route Lab its own module, once', () => {
      expect(verdicts.filter((v) => v !== 'theme' && v !== 'json-ld' && v !== 'route-lab')).toEqual(
        [],
      );
      expect(verdicts.filter((v) => v === 'route-lab')).toHaveLength(
        file === ROUTE_LAB.page ? 1 : 0,
      );
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

    test('JSON-LD is on Home, the résumé and published posts only, one block each', () => {
      const post = /^(writing|notes)\/[a-z0-9-]+\/index\.html$/.test(file) && !isNoindex(page);
      const own = ['index.html', 'resume/index.html'].includes(file);
      expect(verdicts.filter((v) => v === 'json-ld')).toHaveLength(own || post ? 1 : 0);
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

test('known answers: the Route Lab module is allowed on its page only, from /_astro/, never inline', () => {
  const boot = {
    attributes: {
      type: 'module',
      src: '/_astro/RouteLab.astro_astro_type_script_index_0_lang.BW_ExEQE.js',
    },
    body: '',
  };
  expect(classify(boot, ROUTE_LAB.page)).toBe('route-lab');
  expect(classify(boot, 'index.html')).toMatch(/^not allowed/);
  expect(classify(boot, 'lab/index.html')).toMatch(/^not allowed/);
  expect(classify(boot)).toMatch(/^not allowed/);
  // Another bundle, an inline module, an extra attribute or a classic script: refused there too.
  expect(
    classify(
      { attributes: { type: 'module', src: '/_astro/other.BW_ExEQE.js' }, body: '' },
      ROUTE_LAB.page,
    ),
  ).toMatch(/^not allowed/);
  expect(
    classify({ attributes: { type: 'module' }, body: 'import "./x.js"' }, ROUTE_LAB.page),
  ).toMatch(/^not allowed/);
  expect(
    classify({ ...boot, attributes: { ...boot.attributes, async: '' } }, ROUTE_LAB.page),
  ).toMatch(/^not allowed/);
  expect(classify({ attributes: { src: boot.attributes.src }, body: '' }, ROUTE_LAB.page)).toMatch(
    /^not allowed/,
  );
  expect(
    classify(
      {
        attributes: {
          type: 'module',
          src: 'https://cdn.example.net/RouteLab.astro_astro_type_script_index_0_lang.x.js',
        },
        body: '',
      },
      ROUTE_LAB.page,
    ),
  ).toMatch(/^not allowed/);
});
