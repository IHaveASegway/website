import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { ORIGIN } from '../src/lib/site';
import { tags, THEME_SCRIPT } from '../src/lib/weights';
import { html, read, textFiles } from './support/dist';

// The page policy's shape, read from the built HTML (security.md, "Headers and Content Security
// Policy"). e2e/csp.spec.ts proves the same policy in a browser; this proves it on every build,
// without one, so a Dependabot pull request that changes Astro's output is caught in verify.

const FORBIDDEN_SCRIPT_SOURCES = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  '*',
  'data:',
  'https:',
  'http:',
];
const themeHash = `'sha256-${createHash('sha256').update(THEME_SCRIPT).digest('base64')}'`;

/** The directives the policy holds, and no others (security.md, "Headers and Content Security
 *  Policy"). A new directive, or a host in any of them, is a change to this list in review. */
const DIRECTIVES: Readonly<Record<string, readonly string[] | 'self and hashes'>> = {
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

    test('the policy <meta> comes before every <script>, so it covers each of them', () => {
      const meta = page.search(/<meta http-equiv="content-security-policy"/i);
      const scripts = [...page.matchAll(/<script\b/gi)].map((m) => m.index ?? -1);
      expect(scripts.length).toBeGreaterThan(0);
      for (const at of scripts) expect(at).toBeGreaterThan(meta);
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
      expect([...directives.keys()].sort()).toEqual(Object.keys(DIRECTIVES).sort());
      for (const [name, value] of Object.entries(DIRECTIVES)) {
        if (value !== 'self and hashes') expect(directives.get(name), name).toEqual(value);
      }
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
