import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { ORIGIN } from '../src/lib/site';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read, textFiles } from './support/dist';
import { attribute, elementsOf, markupOf } from './support/html';

// The page policy's shape, read from the built HTML (security.md, "Headers and Content Security
// Policy"). e2e/csp.spec.ts proves the same policy in a browser; this proves it on every build,
// without one, so a Dependabot pull request that changes Astro's output is caught in verify.

// 'wasm-unsafe-eval' is refused on every page, the Route Lab included: its worker carries it, in
// the worker's own response header, and a page's policy never governs a worker (ADR 0016).
const FORBIDDEN_SCRIPT_SOURCES = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  '*',
  'data:',
  'https:',
  'http:',
];
const themeHash = `'sha256-${createHash('sha256').update(THEME_SCRIPT).digest('base64')}'`;

/** The directives the policy holds, and no others (security.md, "Headers and Content Security
 *  Policy"). A new directive, or a host in any of them, is a change to this list in review. */
type Directives = Readonly<Record<string, readonly string[] | 'self and hashes'>>;
const DIRECTIVES: Directives = {
  'default-src': ["'self'"],
  'img-src': ["'self'"],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'script-src': 'self and hashes',
  'style-src': 'self and hashes',
};
const HASH = /^'sha256-[A-Za-z0-9+/]+={0,2}'$/;

/** The one page whose policy adds a directive (ADR 0016): the Route Lab starts a module worker,
 *  and names this origin as the only place one may come from. */
const PAGE_DIRECTIVES: Readonly<Record<string, Directives>> = {
  'lab/routes/index.html': { 'worker-src': ["'self'"] },
};

/** The directives a page's policy must hold: the site's, plus that page's own. */
export const directivesFor = (file: string): Directives => ({
  ...DIRECTIVES,
  ...PAGE_DIRECTIVES[file],
});

/** Each element that carries a style attribute, as the browser's parser reads the page: a ">" in
 *  another attribute's value, a comment or a script's text cannot hide one or invent one. */
export function styled(page: string): string[] {
  return elementsOf(page)
    .filter((element) => attribute(element, 'style') !== undefined)
    .map(markupOf);
}

/** Sources outside 'self' and sha256 hashes: none may ship while the site loads nothing from
 *  another origin (the Web Analytics beacon's exact path joins script-src in its own change). */
export function foreignSources(sources: readonly string[]): string[] {
  return sources.filter((source) => source !== "'self'" && !HASH.test(source));
}

/** The policy's directives, from the <meta http-equiv="content-security-policy"> tag. */
export function policy(page: string): Map<string, string[]> {
  const content = /<meta http-equiv="content-security-policy" content="([^"]*)">/i.exec(page)?.[1];
  if (content === undefined) throw new Error('no CSP <meta>');
  return new Map(
    content
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

for (const file of html) {
  describe(file, () => {
    const page = read(file);
    const directives = policy(page);

    test('the policy <meta> comes before every <script> but the theme script, which runs first in <head>', () => {
      const meta = page.search(/<meta http-equiv="content-security-policy"/i);
      expect(meta).toBeGreaterThan(0);
      const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
        index: m.index ?? -1,
        attributes: (m[1] ?? '').trim(),
        body: m[2] ?? '',
      }));
      expect(scripts.length).toBeGreaterThan(0);
      // Exactly one script may run before the policy: the theme script, byte for byte, with no
      // attributes. Any other script before the policy would run uncovered.
      const before = scripts.filter((s) => s.index < meta);
      expect(before.map((s) => [s.attributes, s.body])).toEqual([['', THEME_SCRIPT]]);
      expect(scripts[0]?.index).toBe(before[0]?.index);
    });

    test("script-src allows nothing broad: no 'unsafe-inline', 'unsafe-eval', *, data:, https: or http:", () => {
      const sources = directives.get('script-src') ?? [];
      expect(sources).toContain("'self'");
      expect(sources.filter((s) => FORBIDDEN_SCRIPT_SOURCES.includes(s))).toEqual([]);
    });

    test('the theme script hash is in script-src, computed from the file the page inlines', () => {
      expect(directives.get('script-src')).toContain(themeHash);
      const inline = tags(page, 'script').filter((s) => Object.keys(s.attributes).length === 0);
      expect(inline.map((s) => s.body)).toEqual([THEME_SCRIPT]);
    });

    test("style-src has no 'unsafe-inline', and every inline <style> is hashed", () => {
      const sources = directives.get('style-src') ?? [];
      expect(sources).not.toContain("'unsafe-inline'");
      for (const style of tags(page, 'style')) {
        const hash = `'sha256-${createHash('sha256').update(style.body).digest('base64')}'`;
        expect(sources, style.body.slice(0, 40)).toContain(hash);
      }
    });

    test('the policy holds exactly the known directives, as security.md sets them', () => {
      const expected = directivesFor(file);
      expect([...directives.keys()].sort()).toEqual(Object.keys(expected).sort());
      for (const [name, value] of Object.entries(expected)) {
        if (value !== 'self and hashes') expect(directives.get(name), name).toEqual(value);
      }
    });

    // A style attribute is inline style, which style-src refuses without 'unsafe-inline' or
    // 'unsafe-hashes'. Astro writes none; in a post, Markdown writes one for a table column's
    // alignment (":--:"), and raw HTML can carry one. Leave columns unaligned, and style in CSS.
    test('no element carries a style attribute: the policy refuses them', () => {
      expect(styled(page)).toEqual([]);
    });

    test("script-src and style-src hold only 'self' and sha256 hashes: no host, no scheme", () => {
      for (const name of ['script-src', 'style-src']) {
        const sources = directives.get(name) ?? [];
        expect(sources, name).toContain("'self'");
        expect(foreignSources(sources), name).toEqual([]);
      }
    });
  });
}

// Requests the policy never sees: a <meta> policy covers only what follows it, so the head's
// preloads, icons and font <style> come before it, and no CSP directive governs preconnect or
// dns-prefetch. So every URL the browser would fetch on its own, in every page and stylesheet,
// must be on this origin: root-relative, or absolute on ORIGIN.
const FETCHED: readonly [string, readonly string[]][] = [
  ['link', ['href', 'imagesrcset']],
  ['script', ['src']],
  ['img', ['src', 'srcset']],
  ['source', ['src', 'srcset']],
  ['iframe', ['src']],
  ['video', ['src', 'poster']],
  ['audio', ['src']],
  ['track', ['src']],
  ['embed', ['src']],
  ['object', ['data']],
  ['input', ['src']],
  ['image', ['href', 'xlink:href']],
  ['use', ['href', 'xlink:href']],
  ['a', ['ping']],
  ['area', ['ping']],
];

/** Every URL a page or stylesheet would make the browser fetch by itself. */
export function fetchedUrls(text: string): string[] {
  const urls: string[] = [];
  for (const [element, attributes] of FETCHED) {
    for (const [tag = ''] of text.matchAll(new RegExp(`<${element}\\b[^>]*>`, 'gi'))) {
      for (const attribute of attributes) {
        const value = new RegExp(
          `\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
          'i',
        ).exec(tag);
        const found = value?.[1] ?? value?.[2] ?? value?.[3];
        if (found === undefined) continue;
        // srcset and ping hold lists: each URL is the first word of a comma- or space-separated entry.
        const list = /srcset$/i.test(attribute)
          ? found.split(',').map((entry) => entry.trim().split(/\s+/)[0] ?? '')
          : attribute === 'ping'
            ? found.split(/\s+/)
            : [found];
        urls.push(...list.filter(Boolean));
      }
    }
  }
  for (const [, quoted1, quoted2, bare] of text.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi,
  )) {
    urls.push(quoted1 ?? quoted2 ?? bare ?? '');
  }
  for (const [, quoted1, quoted2] of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    urls.push(quoted1 ?? quoted2 ?? '');
  }
  return urls;
}

/** A URL that leaves the origin: absolute or protocol-relative on another host. A data: URL is
 *  refused as well: the policy forbids it, and it carries bytes no scan reads as a file. */
export function offOrigin(url: string): boolean {
  if (/^data:/i.test(url)) return true;
  if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return false; // relative to this origin
  try {
    return new URL(url, `${ORIGIN}/`).origin !== ORIGIN;
  } catch {
    return true;
  }
}

describe('nothing the browser fetches leaves the origin', () => {
  // Every text file, whatever its name: markup and stylesheets are what the parser reads, and it
  // finds nothing in the rest.
  const scanned = textFiles;
  test('there are pages and stylesheets to scan', () => {
    expect(scanned.filter((f) => f.endsWith('.html')).length).toBeGreaterThan(0);
    expect(scanned.filter((f) => f.endsWith('.css')).length).toBeGreaterThan(0);
  });
  for (const file of scanned) {
    test(file, () => {
      const urls = fetchedUrls(read(file));
      if (file.endsWith('.html')) expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter(offOrigin)).toEqual([]);
    });
  }

  test('known answers: a foreign preconnect, prefetch, preload, script or url() is caught', () => {
    const foreign = [
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link rel="dns-prefetch" href="//static.example.net">',
      "<link rel=preload href='https://cdn.example.net/a.woff2' as=font>",
      '<script defer src="https://static.example.net/beacon.min.js"></script>',
      '<img srcset="/a.png 1x, https://cdn.example.net/b.png 2x">',
      '<a href="/" ping="https://tracker.example.net/p">',
      '.a{background:url(https://cdn.example.net/x.png)}',
      "@import 'https://cdn.example.net/x.css';",
      '<img src="data:image/png;base64,AAAA">',
    ];
    for (const text of foreign) {
      expect(fetchedUrls(text).filter(offOrigin), text).not.toEqual([]);
    }
    const local = [
      '<link rel="preload" href="/_astro/fonts/a.woff2" as="font">',
      `<link rel="canonical" href="${ORIGIN}/">`,
      '.a{background:url("/x.png")}',
      '<a href="https://www.linkedin.com/in/x/">',
    ];
    for (const text of local) {
      expect(fetchedUrls(text).filter(offOrigin), text).toEqual([]);
    }
  });
});

test('known answers: a style attribute is found as the browser parses the page, and only then', () => {
  expect(styled('<p style="color: red">a</p>')).toEqual(['<p style="color: red">']);
  expect(styled("<p STYLE=x>a</p><p\nstyle='y'>b</p><p style>c</p>")).toHaveLength(3);
  expect(styled('<svg><rect style="fill: red"/></svg>')).toEqual(['<rect style="fill: red">']);
  // A ">" inside a quoted value does not end the tag: the style attribute after it is still found.
  expect(styled('<a title="a>b" style="x">link</a>')).toEqual(['<a title="a>b" style="x">']);
  // None of these is a style attribute: another attribute's name or value, a comment, script text.
  expect(styled('<p data-style="x" title=" style=x">a</p>')).toEqual([]);
  expect(styled('<!-- <p style="x"> --><script>let s = "<p style=x>";</script>')).toEqual([]);
});

test('known answers: worker-src belongs to the Route Lab alone, and wasm-unsafe-eval to no page', () => {
  expect(Object.keys(directivesFor('lab/routes/index.html'))).toContain('worker-src');
  for (const file of ['index.html', 'lab/index.html', '404.html', 'writing/index.html'])
    expect(Object.keys(directivesFor(file)), file).not.toContain('worker-src');
  const page = (sources: string) =>
    `<meta http-equiv="content-security-policy" content="script-src ${sources}; worker-src 'self'">`;
  const sources = policy(page("'self' 'wasm-unsafe-eval'")).get('script-src') ?? [];
  expect(sources.filter((s) => FORBIDDEN_SCRIPT_SOURCES.includes(s))).toEqual([
    "'wasm-unsafe-eval'",
  ]);
});

test('known answer: the parser reads a policy and the check sees a broad source', () => {
  const sample =
    '<meta http-equiv="content-security-policy" content="script-src \'self\' https:; img-src \'self\'">';
  expect(policy(sample).get('script-src')).toEqual(["'self'", 'https:']);
  expect(["'self'", 'https:'].filter((s) => FORBIDDEN_SCRIPT_SOURCES.includes(s))).toEqual([
    'https:',
  ]);
  expect(
    foreignSources([
      "'self'",
      "'sha256-MhseHoHkC705lpWBmWy332bsj822YikqateS/bKBTrs='",
      'https://static.cloudflareinsights.com/beacon.min.js',
      "'unsafe-hashes'",
    ]),
  ).toEqual(['https://static.cloudflareinsights.com/beacon.min.js', "'unsafe-hashes'"]);
});
