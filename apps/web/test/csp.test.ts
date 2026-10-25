import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  DIRECTIVES as SITE_DIRECTIVES,
  inlineCode,
  PAGE_DIRECTIVES as SITE_PAGE_DIRECTIVES,
  policyFor,
  withPagePolicies,
} from '../src/lib/csp.mjs';
import { ORIGIN } from '../src/lib/site';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read, textFiles } from './support/dist';
import { headersFor } from './support/headers';
import { attribute, elementsOf, markupOf } from './support/html';

// The page policy's shape, read from the build's _headers for each page's path, as the asset server
// would send it (security.md, "Headers and Content Security Policy"; ADR 0018). e2e/csp.spec.ts
// proves the same policy in a browser; this proves it on every build, without one, so a Dependabot
// pull request that changes Astro's output is caught in verify. The directives below are written
// out here rather than imported from src/lib/csp.mjs, so a change there is a change here in review.

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
  'frame-ancestors': ["'none'"],
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

/** A header policy's directives. Two policies in one header, joined by a comma when two rules set
 *  it, are refused: each would only restrict the other, and the page has one owner. So is a
 *  directive named twice: a browser enforces the first copy and ignores the rest, so a check that
 *  read the last would pass a policy the browser reads otherwise. */
export function directivesOf(value: string): Map<string, string[]> {
  if (value.includes(',')) throw new Error(`two policies in one header: ${value}`);
  const directives = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const [name = '', ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    if (directives.has(name)) throw new Error(`${name} is named twice: ${value}`);
    directives.set(name, sources);
  }
  return directives;
}

/** The one kind of inline style a page may hold: the Fonts API's, each face's @font-face rule and
 *  its family's custom property on :root (security.md). The policy hashes every inline <style>
 *  the build finds, so this is the alarm for one nothing else wrote: a post's raw HTML, an
 *  integration, a dependency. The script allowlist is test/scripts.test.ts. */
export const FONTS_STYLE = /^(?:@font-face\{[^{}]*\})+:root\{--font-[a-z-]+:"[^"]+";\}$/;

/** The path a built page answers at: its folder, or for the 404, a path no page has. */
export const pathOf = (file: string): string =>
  file === '404.html' ? '/this-page-does-not-exist/' : `/${file.replace(/index\.html$/, '')}`;

/** The policy the build's _headers sends for a page. */
export function headerPolicy(file: string): string {
  const value = headersFor(read('_headers'), pathOf(file)).get('content-security-policy');
  if (value === undefined) throw new Error(`no policy for ${pathOf(file)}`);
  return value;
}

for (const file of html) {
  describe(file, () => {
    const page = read(file);
    const directives = directivesOf(headerPolicy(file));

    test('no <meta> policy: the header the build writes is the one owner (ADR 0018)', () => {
      expect(page).not.toMatch(/<meta http-equiv="content-security-policy"/i);
    });

    test("the header is the page's own policy, a hash for each inline script and style it holds", () => {
      expect(headerPolicy(file)).toBe(
        policyFor(page, file === '404.html' ? '/404.html' : pathOf(file)),
      );
    });

    test('the theme script is the first script, in <head>, byte for byte the file, and governed', () => {
      const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      const [first] = scripts;
      expect([(first?.[1] ?? '').trim(), first?.[2]]).toEqual(['', THEME_SCRIPT]);
      expect(first?.index ?? Infinity).toBeLessThan(page.indexOf('</head>'));
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

    test("every inline <style> is the Fonts API's, and nothing else's", () => {
      for (const style of tags(page, 'style'))
        expect(style.body, style.body.slice(0, 60)).toMatch(FONTS_STYLE);
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

// Requests the policy never sees: no CSP directive governs preconnect or dns-prefetch. So every
// URL the browser would fetch on its own, in every page and stylesheet, must be on this origin:
// root-relative, or absolute on ORIGIN, whatever the policy would also allow.
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

test("known answers: the Fonts API's style passes the allowlist, and any other inline style fails", () => {
  const face =
    '@font-face{font-family:"Instrument Sans-ee491b7e";src:url("/_astro/fonts/8ed8.woff2") format("woff2");font-display:swap;}';
  expect(`${face}:root{--font-instrument-sans:"Instrument Sans-ee491b7e";}`).toMatch(FONTS_STYLE);
  expect(`${face}${face}:root{--font-jetbrains-mono:"JetBrains Mono-c8b3";}`).toMatch(FONTS_STYLE);
  for (const other of ['p{color:red}', `${face}p{color:red}`, `${face}:root{--x:"y";}body{}`])
    expect(other).not.toMatch(FONTS_STYLE);
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
  const sources =
    directivesOf("script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'").get('script-src') ?? [];
  expect(sources.filter((s) => FORBIDDEN_SCRIPT_SOURCES.includes(s))).toEqual([
    "'wasm-unsafe-eval'",
  ]);
});

test('known answer: the parser reads a policy, refuses two, and the check sees a broad source', () => {
  expect(directivesOf("script-src 'self' https:; img-src 'self'").get('script-src')).toEqual([
    "'self'",
    'https:',
  ]);
  expect(() => directivesOf("frame-ancestors 'none', default-src 'self'")).toThrow(/two policies/);
  // A browser keeps the first script-src; reading the last would pass the hashes it drops.
  expect(() => directivesOf("script-src https://a.example; script-src 'self' 'sha256-x'")).toThrow(
    /named twice/,
  );
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

// Known answers on src/lib/csp.mjs, with pages and files of their own.
describe('known answers: the policy the build writes', () => {
  const page = (head: string, body = '') =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  test('the inline code is what runs: scripts without src and of a script type, and every style', () => {
    const code = inlineCode(
      page(
        '<script>a()</script><script type="module">b()</script><script src="/c.js"></script>' +
          '<script type="application/ld+json">{"@type":"Person"}</script><style>p{}</style>',
        '<svg><style>rect{}</style></svg><template><script>d()</script></template>',
      ),
    );
    expect(code).toEqual({ scripts: ['a()', 'b()', 'd()'], styles: ['p{}', 'rect{}'] });
  });

  test('a policy hashes each inline script and style once, and adds a page its own directives', () => {
    const html = page('<script>a()</script><script>a()</script><style>p{}</style>');
    const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
    expect(policyFor(html, '/')).toBe(
      `${SITE_DIRECTIVES.join('; ')}; script-src 'self' ${hash('a()')}; style-src 'self' ${hash('p{}')}`,
    );
    expect(policyFor(page(''), '/lab/routes/')).toContain("worker-src 'self'; script-src 'self';");
  });

  test('the 404\'s policy goes on "/*", and a page whose policy differs detaches it in a rule of its own', () => {
    const file = '/*\n  X-Content-Type-Options: nosniff\n';
    const shared = "default-src 'self'";
    const written = withPagePolicies(
      file,
      new Map([
        ['/404.html', shared],
        ['/', shared],
        ['/lab/routes/', `${shared}; worker-src 'self'`],
      ]),
    );
    expect(headersFor(written, '/').get('content-security-policy')).toBe(shared);
    expect(headersFor(written, '/nope/').get('content-security-policy')).toBe(shared);
    expect(headersFor(written, '/lab/routes/').get('content-security-policy')).toBe(
      `${shared}; worker-src 'self'`,
    );
    expect(written.match(/^\/lab\/routes\/$/gm)).toHaveLength(1);
    expect(written).not.toMatch(/^\/$/m);
  });

  test('it refuses a "/*" rule that already sends a policy, and a build with no 404', () => {
    const policies = new Map([['/404.html', "default-src 'self'"]]);
    expect(() =>
      withPagePolicies("/*\n  Content-Security-Policy: frame-ancestors 'none'\n", policies),
    ).toThrow(/already sends a policy/);
    // Read as the server reads it: an unindented header line still belongs to "/*".
    expect(() =>
      withPagePolicies("/*\nContent-Security-Policy: frame-ancestors 'none'\n", policies),
    ).toThrow(/already sends a policy/);
    expect(() => withPagePolicies('/*\n  X-A: b\n', new Map([['/', 'x']]))).toThrow(/no 404/);
    expect(() => withPagePolicies('/x\n  X-A: b\n', policies)).toThrow(/0 "\/\*" rules/);
  });

  test('it refuses what the server would read otherwise: a second "/*", a page rule already there, the limits', () => {
    const policies = new Map([
      ['/404.html', "default-src 'self'"],
      ['/a/', "default-src 'none'"],
    ]);
    expect(() => withPagePolicies('/*\n  X-A: b\n\n/*\n  X-C: d\n', policies)).toThrow(
      /2 "\/\*" rules/,
    );
    expect(() => withPagePolicies('/*\n  X-A: b\n\n/a/\n  X-C: d\n', policies)).toThrow(
      /already has a rule for \/a\//,
    );
    // The server trims a line, so "/* " is the "/*" rule, but the policy is written under "/*" alone.
    expect(() => withPagePolicies('/* \n  X-A: b\n', policies)).toThrow(
      /no _headers line is "\/\*"/,
    );
    // A URL with a host opens a rule too, which would otherwise read as a header of the rule above.
    expect(() =>
      withPagePolicies('/*\n  X-A: b\nhttps://example.com/*\n  X-C: d\n', policies),
    ).toThrow(/rule for a host, https:\/\/example\.com\/\*/);
    const long = new Map([
      ['/404.html', `default-src 'self'; script-src ${"'sha256-x' ".repeat(200)}`],
    ]);
    expect(() => withPagePolicies('/*\n  X-A: b\n', long)).toThrow(/over 2000 characters/);
    const many = new Map([
      ['/404.html', "default-src 'self'"],
      ...Array.from(
        { length: 100 },
        (_, i) => [`/p${i}/`, `default-src 'none'; x-${i} 'self'`] as const,
      ),
    ]);
    expect(() => withPagePolicies('/*\n  X-A: b\n', many)).toThrow(/101 rules, over 100/);
  });

  test("added sources join the page's one directive, and 'none' joins none", () => {
    const html = page('<script>a()</script>');
    const pages = SITE_PAGE_DIRECTIVES as Record<string, string[]>;
    // As security.md plans them: the beacon's origin on every page, Turnstile's on a lab page.
    SITE_DIRECTIVES.push('script-src https://beacon.example.net');
    pages['/turnstile/'] = [
      'script-src https://challenges.example.net',
      'connect-src https://challenges.example.net',
    ];
    pages['/twice/'] = ["default-src 'none'"];
    pages['/framed/'] = ["frame-ancestors 'self'"];
    try {
      const site = policyFor(html, '/');
      expect(site.match(/script-src/g)).toHaveLength(1);
      expect(site).toContain("script-src 'self' https://beacon.example.net 'sha256-");
      const lab = policyFor(html, '/turnstile/');
      expect(lab.match(/script-src/g)).toHaveLength(1);
      expect(lab).toContain(
        "script-src 'self' https://beacon.example.net https://challenges.example.net 'sha256-",
      );
      expect(lab.match(/connect-src/g)).toHaveLength(1);
      expect(lab).toContain("connect-src 'self' https://challenges.example.net;");
      expect(() => policyFor(html, '/twice/')).toThrow(/default-src is named twice/);
      expect(() => policyFor(html, '/framed/')).toThrow(/frame-ancestors is named twice/);
    } finally {
      SITE_DIRECTIVES.pop();
      for (const path of ['/turnstile/', '/twice/', '/framed/']) delete pages[path];
    }
  });

  test('every script type a browser runs or governs is hashed, whatever its parameters', () => {
    const code = inlineCode(
      page(
        '<script type="importmap">{}</script><script type="text/javascript; charset=utf-8">b()</script>' +
          '<script type="TEXT/ECMASCRIPT">c()</script><script type="text/plain">d()</script>',
      ),
    );
    expect(code.scripts).toEqual(['{}', 'b()', 'c()']);
  });
});
