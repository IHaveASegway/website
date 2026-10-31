import { describe, expect, test } from 'vitest';
import { isNoindex } from '../src/lib/noindex.mjs';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read } from './support/dist';

// The script allowlist (spec B13): a page may carry the inline theme script, exactly as
// src/scripts/theme.js has it and first in <head>, and JSON-LD, which Home, /about/ and each
// published post carry. Anything else fails, whatever wrote it: a component, an integration, a
// dependency. The Web Analytics beacon joins the list in the pull request that ships it.
//
// One page has a third kind, and only one of it (ADR 0016): the Route Lab, /lab/routes/, loads its
// own module, the bundle Astro builds from its component's script (components/route-lab/boot.ts),
// from /_astro/ and never inline. It shows the demo's controls and loads the rest on first use;
// test/budgets.test.ts holds it to the eager budget every page has.
//
// And every page has a fourth, once (design-system.md, "The command menu"): the command menu's
// module, the bundle Astro builds from components/Palette.astro's script (src/scripts/palette.js),
// from /_astro/ and never inline, after the theme script and in <body>.
//
// The Raft Lab, /lab/raft/, loads its own module the same way, on its page only (ADR 0020): the
// bundle of components/raft-lab/RaftLab.astro's script (boot.ts), which loads the rest on intent.
//
// So does the Queue Lab, /lab/queue/ (ADR 0026): the bundle of components/queue-lab/QueueLab.astro's
// script (boot.ts), on its page only.
//
// And Home and the indexes have a fifth, once (design-system.md, "Motion"): the module of
// components/Motion.astro (src/scripts/motion.js), which decodes a card's tag and hands a followed
// title to the next page. A post, a demo, /about/ and the 404 carry none.

type Verdict =
  'theme' | 'json-ld' | 'route-lab' | 'raft-lab' | 'queue-lab' | 'palette' | 'motion' | string;

/** The one page allowed a module of its own, and the name Astro gives that module's bundle. */
export const ROUTE_LAB = {
  page: 'lab/routes/index.html',
  src: /^\/_astro\/RouteLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
} as const;

/** The Raft Lab's page and the name Astro gives its module's bundle. */
export const RAFT_LAB = {
  page: 'lab/raft/index.html',
  src: /^\/_astro\/RaftLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
} as const;

/** The Queue Lab's page and the name Astro gives its module's bundle. */
export const QUEUE_LAB = {
  page: 'lab/queue/index.html',
  src: /^\/_astro\/QueueLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
} as const;

/** The name Astro gives the command menu's bundle, which every page loads. */
export const PALETTE = /^\/_astro\/Palette\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/;

/** The pages that carry the motion module, Home and the indexes, and the name of its bundle. */
export const MOTION = {
  pages: /^(?:(?:writing|notes|lab)\/)?index\.html$/,
  src: /^\/_astro\/Motion\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
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
  if (
    page === RAFT_LAB.page &&
    names === 'src type' &&
    script.attributes['type'] === 'module' &&
    RAFT_LAB.src.test(script.attributes['src'] ?? '') &&
    script.body === ''
  )
    return 'raft-lab';
  if (
    page === QUEUE_LAB.page &&
    names === 'src type' &&
    script.attributes['type'] === 'module' &&
    QUEUE_LAB.src.test(script.attributes['src'] ?? '') &&
    script.body === ''
  )
    return 'queue-lab';
  if (
    names === 'src type' &&
    script.attributes['type'] === 'module' &&
    PALETTE.test(script.attributes['src'] ?? '') &&
    script.body === ''
  )
    return 'palette';
  if (
    MOTION.pages.test(page) &&
    names === 'src type' &&
    script.attributes['type'] === 'module' &&
    MOTION.src.test(script.attributes['src'] ?? '') &&
    script.body === ''
  )
    return 'motion';
  return `not allowed: <script ${names}> ${script.body.slice(0, 60)}`;
}

for (const file of html) {
  describe(file, () => {
    const page = read(file);
    const verdicts = tags(page, 'script').map((script) => classify(script, file));

    test("every script is the theme script, JSON-LD or the command menu's module, once, on the Route Lab its own module, and on Home and the indexes the motion module", () => {
      const known = ['theme', 'json-ld', 'route-lab', 'raft-lab', 'queue-lab', 'palette', 'motion'];
      expect(verdicts.filter((v) => v === 'raft-lab')).toHaveLength(file === RAFT_LAB.page ? 1 : 0);
      expect(verdicts.filter((v) => v === 'queue-lab')).toHaveLength(
        file === QUEUE_LAB.page ? 1 : 0,
      );
      expect(verdicts.filter((v) => v === 'motion').length).toBeLessThanOrEqual(1);
      expect(verdicts.filter((v) => !known.includes(v))).toEqual([]);
      expect(verdicts.filter((v) => v === 'route-lab')).toHaveLength(
        file === ROUTE_LAB.page ? 1 : 0,
      );
      expect(verdicts.filter((v) => v === 'palette')).toHaveLength(1);
      // In <body>, so the theme script in <head> still runs first.
      const body = page.slice(page.indexOf('<body'));
      expect(tags(body, 'script').filter((s) => classify(s, file) === 'palette')).toHaveLength(1);
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

    test('JSON-LD is on Home, /about/ and published posts only, one block each', () => {
      const post = /^(writing|notes)\/[a-z0-9-]+\/index\.html$/.test(file) && !isNoindex(page);
      const own = ['index.html', 'about/index.html'].includes(file);
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

test("known answers: the command menu's module is allowed on any page, from /_astro/, never inline", () => {
  const menu = {
    attributes: {
      type: 'module',
      src: '/_astro/Palette.astro_astro_type_script_index_0_lang.BlEyArqa.js',
    },
    body: '',
  };
  expect(classify(menu)).toBe('palette');
  expect(classify(menu, ROUTE_LAB.page)).toBe('palette');
  expect(classify(menu, '404.html')).toBe('palette');
  // Its code inline, a classic script, an extra attribute or a foreign host: refused.
  expect(classify({ attributes: { type: 'module' }, body: 'import "./palette.js"' })).toMatch(
    /^not allowed/,
  );
  expect(classify({ attributes: { src: menu.attributes.src }, body: '' })).toMatch(/^not allowed/);
  expect(classify({ ...menu, attributes: { ...menu.attributes, async: '' } })).toMatch(
    /^not allowed/,
  );
  expect(
    classify({
      attributes: {
        type: 'module',
        src: 'https://cdn.example.net/Palette.astro_astro_type_script_index_0_lang.x.js',
      },
      body: '',
    }),
  ).toMatch(/^not allowed/);
  // The Route Lab's module stays its page's alone.
  expect(
    classify({
      attributes: {
        type: 'module',
        src: '/_astro/RouteLab.astro_astro_type_script_index_0_lang.BW_ExEQE.js',
      },
      body: '',
    }),
  ).toMatch(/^not allowed/);
});

test('known answers: the motion module is allowed on Home and the indexes only, from /_astro/, never inline', () => {
  const motion = {
    attributes: {
      type: 'module',
      src: '/_astro/Motion.astro_astro_type_script_index_0_lang.BXQDCniR.js',
    },
    body: '',
  };
  for (const page of ['index.html', 'writing/index.html', 'notes/index.html', 'lab/index.html'])
    expect(classify(motion, page), page).toBe('motion');
  // A post, a demo, /about/ and the 404 carry none, nor does a page this test does not name.
  for (const page of [
    'writing/a-post/index.html',
    ROUTE_LAB.page,
    'about/index.html',
    '404.html',
    'xindex.html',
    '',
  ])
    expect(classify(motion, page), page).toMatch(/^not allowed/);
  expect(
    classify({ attributes: { type: 'module' }, body: 'import "./motion.js"' }, 'index.html'),
  ).toMatch(/^not allowed/);
  expect(
    classify({ ...motion, attributes: { ...motion.attributes, defer: '' } }, 'index.html'),
  ).toMatch(/^not allowed/);
});

test('known answers: the Raft Lab module is allowed on its page only, from /_astro/, never inline', () => {
  const boot = {
    attributes: {
      type: 'module',
      src: '/_astro/RaftLab.astro_astro_type_script_index_0_lang.D5gT1Uuz.js',
    },
    body: '',
  };
  expect(classify(boot, RAFT_LAB.page)).toBe('raft-lab');
  for (const page of [ROUTE_LAB.page, 'index.html', 'lab/index.html', ''])
    expect(classify(boot, page), page).toMatch(/^not allowed/);
  // The Route Lab's module is not allowed on the Raft Lab's page, nor an inline or classic one.
  expect(
    classify(
      {
        attributes: {
          type: 'module',
          src: '/_astro/RouteLab.astro_astro_type_script_index_0_lang.BW_ExEQE.js',
        },
        body: '',
      },
      RAFT_LAB.page,
    ),
  ).toMatch(/^not allowed/);
  expect(
    classify({ attributes: { type: 'module' }, body: 'import "./boot"' }, RAFT_LAB.page),
  ).toMatch(/^not allowed/);
  expect(classify({ attributes: { src: boot.attributes.src }, body: '' }, RAFT_LAB.page)).toMatch(
    /^not allowed/,
  );
});

test('known answers: the Queue Lab module is allowed on its page only, from /_astro/, never inline', () => {
  const boot = {
    attributes: {
      type: 'module',
      src: '/_astro/QueueLab.astro_astro_type_script_index_0_lang.B8oZLDdY.js',
    },
    body: '',
  };
  expect(classify(boot, QUEUE_LAB.page)).toBe('queue-lab');
  for (const page of [RAFT_LAB.page, ROUTE_LAB.page, 'index.html', 'lab/index.html', ''])
    expect(classify(boot, page), page).toMatch(/^not allowed/);
  // The Raft Lab's module is not allowed on the Queue Lab's page, nor an inline or classic one.
  expect(
    classify(
      {
        attributes: {
          type: 'module',
          src: '/_astro/RaftLab.astro_astro_type_script_index_0_lang.D5gT1Uuz.js',
        },
        body: '',
      },
      QUEUE_LAB.page,
    ),
  ).toMatch(/^not allowed/);
  expect(
    classify({ attributes: { type: 'module' }, body: 'import "./boot"' }, QUEUE_LAB.page),
  ).toMatch(/^not allowed/);
  expect(classify({ attributes: { src: boot.attributes.src }, body: '' }, QUEUE_LAB.page)).toMatch(
    /^not allowed/,
  );
});
