import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTIVES } from '../src/lib/csp.mjs';
import { isNoindex } from '../src/lib/noindex.mjs';

// What the site must serve. The e2e specs and the production smoke read these, so a change to a
// route or a header is one edit here, in the same pull request as the change itself.

/** The one public origin. Canonical links, the sitemap and every redirect name it. */
export const ORIGIN = 'https://ihaveasegway.com';

/** The URL lines of a ledger-style file: comments and blank lines dropped. */
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** public/_redirects, one [from, to, status] per rule. */
const REDIRECTS: readonly string[][] = existsSync(new URL('../public/_redirects', import.meta.url))
  ? lines(read('../public/_redirects')).map((line) => line.split(/\s+/))
  : [];

/** The moved pages and files, [old, new]: each 301 in public/_redirects (ADR 0005). */
export const MOVED: readonly (readonly [string, string])[] = REDIRECTS.filter(
  ([, , status]) => status === '301',
).map(([from = '', to = '']) => [from, to] as const);

/**
 * Every page the site publishes: each URL in published-urls.txt that no 301 in public/_redirects
 * has moved. A post is published by adding its URL there (ADR 0005). apps/web/test/urls.test.ts
 * fails when the ledger and the build disagree, so the build's pages and these are the same.
 */
export const SITE_PAGES: readonly string[] = (() => {
  const moved = (url: string) =>
    MOVED.some(([from]) => (from.endsWith('*') ? url.startsWith(from.slice(0, -1)) : from === url));
  return lines(read('../published-urls.txt')).filter((url) => !moved(url));
})();

/**
 * The pages of the test-only writing fixture build, .fixtures/fixture-many
 * (scripts/build-fixtures.mjs): Home, /about/, both indexes and the five published posts, and
 * not the draft. pnpm e2e:writing walks these, and test/writing.test.ts holds the build to them.
 */
export const WRITING_FIXTURE_PAGES: readonly string[] = [
  '/',
  '/about/',
  '/notes/',
  '/notes/fixture-small-note/',
  '/notes/fixture-trailing-slashes/',
  '/writing/',
  '/writing/fixture-markdown-tour/',
  '/writing/fixture-measure-first/',
  '/writing/fixture-retries-and-back-off/',
];

/** Which build a run checks: the site, or the writing fixture (E2E_SITE=writing-fixture). */
export const ON_WRITING_FIXTURE = process.env['E2E_SITE'] === 'writing-fixture';

/** The indexable pages a build directory holds, read from the build itself: every index.html but
 *  a noindex one (a draft, in a preview). */
export function pagesIn(dir: string): string[] {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) => {
      const path = join(at, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(dir)
    .filter((path) => path.endsWith(`${sep}index.html`) || path === join(dir, 'index.html'))
    .filter((path) => !isNoindex(readFileSync(path, 'utf8')))
    .map((path) => `/${relative(dir, path).split(sep).join('/').slice(0, -'index.html'.length)}`)
    .sort();
}

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc = '']) => loc);

/**
 * The pages a site's own sitemap lists, as paths: the sitemap index, then each sitemap it names.
 * Every URL must be on `origin`, and the list must hold Home, so a sitemap that names another
 * host, or names nothing, fails instead of shrinking the walk.
 */
export async function sitemapPages(
  origin: string,
  fetchText: (url: string) => Promise<string>,
): Promise<string[]> {
  const onOrigin = (url: string) => {
    if (!url.startsWith(`${origin}/`)) throw new Error(`the sitemap names ${url}, off ${origin}`);
    return new URL(url).pathname;
  };
  const sitemaps = locs(await fetchText(`${origin}/sitemap-index.xml`)).map(onOrigin);
  const pages: string[] = [];
  for (const path of sitemaps)
    pages.push(...locs(await fetchText(`${origin}${path}`)).map(onOrigin));
  return pageList([...new Set(pages)].sort(), `${origin}/sitemap-index.xml`);
}

/** A page list as a run walks it: paths in the slash form, Home among them, or an error. */
function pageList(list: unknown, from: string): string[] {
  if (
    !Array.isArray(list) ||
    !list.every((path) => typeof path === 'string' && /^\/([a-z0-9-]+\/)*$/.test(path)) ||
    !list.includes('/')
  ) {
    throw new Error(`${from} is not a page list with Home in it: ${JSON.stringify(list)}`);
  }
  return list as string[];
}

/** What a run's page list depends on: its environment, as Node gives it. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Every page a run walks, read from the build it serves, so a check never asks for a page that
 * build lacks and never skips one it has (delivery.md, "Deploy, verify, roll back"):
 *
 *   - the writing fixture run: the fixture's pages;
 *   - a run that names the build it serves, DIST_DIR (prod-smoke, in the attempt that promoted):
 *     that build's pages;
 *   - production without its build (prod-smoke re-run, after a rollback, or on a weekly rebuild
 *     the guard stopped): the pages production's own sitemap lists, which the prod config's
 *     global setup reads into PRODUCTION_PAGES before any spec loads (production-pages.ts);
 *   - any other run: the build in apps/web/dist, which the e2e job (a preview, or wrangler dev) and
 *     the deploy job (the Version URL) download, and a laptop builds.
 *
 * A production run with neither list fails, and so does a run with no build: neither falls back to
 * walking fewer pages.
 */
export function pagesFor(env: Env, localBuild: string | undefined): readonly string[] {
  if (env['E2E_SITE'] === 'writing-fixture') return WRITING_FIXTURE_PAGES;
  const deployed = env['DIST_DIR'];
  if (deployed) return pagesIn(deployed);
  if (env['E2E_TARGET'] === 'production') {
    const listed = env['PRODUCTION_PAGES'];
    if (!listed) {
      throw new Error(
        "a production run with neither its build (DIST_DIR) nor production's sitemap (PRODUCTION_PAGES): run it through playwright.prod.config.ts, whose global setup reads the sitemap",
      );
    }
    return pageList(JSON.parse(listed), 'PRODUCTION_PAGES');
  }
  if (localBuild) return pagesIn(localBuild);
  throw new Error('no build to walk: build first (pnpm build), or name one with DIST_DIR');
}

/** apps/web/dist, when it holds a build. */
function localBuild(): string | undefined {
  const local = fileURLToPath(new URL('../dist/', import.meta.url));
  return existsSync(join(local, 'index.html')) ? local : undefined;
}

let walked: readonly string[] | undefined;

/**
 * The pages this run walks (pagesFor), read once, when a spec first asks: after the prod config's
 * global setup, so the axe, CSP, smoke and glyph checks, and the production checks, all walk it.
 */
export function pages(): readonly string[] {
  walked ??= pagesFor(process.env, localBuild());
  return walked;
}

/**
 * Files clients ask for by name, at the paths they look in (ADR 0005). Every release since launch
 * serves each of them, so the smoke still passes after a rollback to any earlier version. A file a
 * page names, such as its og:image, is checked through that page instead (smoke.spec.ts), so an
 * older build that names none is not failed for lacking it.
 */
export const FILES: readonly string[] = [
  '/robots.txt',
  '/.well-known/security.txt',
  '/sitemap-index.xml',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
];

/** A path that never exists, for the 404 checks. */
export const MISSING = '/this-page-does-not-exist/';

/**
 * Worker Previews (open beta, as of 2026-10-23) answer an unknown path with a bare "Not found",
 * although the preview's stored config says not_found_handling "404-page". Version URLs and
 * production serve the 404 page, and the deploy job's smoke and prod-smoke check it there. The e2e
 * job sets E2E_TARGET=worker-preview when it runs against a preview.
 */
export const ON_WORKER_PREVIEW = process.env.E2E_TARGET === 'worker-preview';

/** Where axe and the CSP check read the 404 page: at a missing path, or at /404 on a preview. */
export const NOT_FOUND_PAGE = ON_WORKER_PREVIEW ? '/404' : MISSING;

/** Why the 404 checks are expected to fail on a preview. When Cloudflare fixes it, they pass, and
 * Playwright reports that as a failure: the sign to delete ON_WORKER_PREVIEW. */
export const PREVIEW_404_GAP = 'Worker Previews ignore not_found_handling (expected.ts)';

/** Response headers from public/_headers (security.md, "Headers and Content Security Policy"). The
 *  page policy is the build's, with hashes that change with the pages: pagePolicyProblems reads it. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
};

/** What a build before 2026-10-25 sent as its whole header policy: the rest was a <meta> in each
 *  page (ADR 0018). A rollback to one serves this, and its pages carry the <meta>. */
export const LEGACY_HEADER_POLICY = "frame-ancestors 'none'";

/**
 * Why the Content-Security-Policy headers on a response are not one page policy as the build writes
 * it (src/lib/csp.mjs), one line each: the site's directives exactly, worker-src 'self' at most, and
 * script-src and style-src with 'self' and SHA-256 hashes only. `legacy` is whether the page carries
 * a <meta> policy, as a build before 2026-10-25 did; then its header is frame-ancestors alone.
 */
export function pagePolicyProblems(values: readonly string[], legacy = false): string[] {
  if (values.length !== 1) return [`${values.length} policies, not 1`];
  const [value = ''] = values;
  if (legacy)
    return value === LEGACY_HEADER_POLICY ? [] : [`a <meta> page sends ${value} as its header`];
  const directives = new Map<string, string>();
  const problems: string[] = [];
  for (const part of value.split(';')) {
    const [name = '', ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    // A browser enforces the first copy of a directive and ignores the rest.
    if (directives.has(name)) problems.push(`${name} is named twice`);
    else directives.set(name, sources.join(' '));
  }
  for (const directive of DIRECTIVES) {
    const [name = ''] = directive.split(' ');
    if (`${name} ${directives.get(name) ?? ''}` !== directive) problems.push(`not ${directive}`);
    directives.delete(name);
  }
  for (const name of ['script-src', 'style-src']) {
    const sources = (directives.get(name) ?? '').split(' ');
    if (
      sources[0] !== "'self'" ||
      !sources.slice(1).every((s) => /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(s))
    )
      problems.push(`${name} is not 'self' and hashes: ${directives.get(name) ?? 'missing'}`);
    directives.delete(name);
  }
  if (directives.has('worker-src') && directives.get('worker-src') !== "'self'")
    problems.push(`worker-src ${directives.get('worker-src') ?? ''}`);
  directives.delete('worker-src');
  for (const name of directives.keys()) problems.push(`an unknown directive: ${name}`);
  return problems;
}

/** Headers this site never sends (security.md, "Never sent"). */
export const NEVER_SENT = ['x-xss-protection', 'expect-ct', 'x-frame-options'] as const;

/** The Route Lab's page and its solver's folder, named in the lock (ADR 0016). */
export const ROUTE_LAB = '/lab/routes/';
export const SOLVER = `/lab/routes/solver/${
  (
    JSON.parse(
      readFileSync(new URL('../src/lib/route-lab/solver.lock.json', import.meta.url), 'utf8'),
    ) as { folder: string }
  ).folder
}/`;

/** The policy the solver's responses carry, alone, since their rule detaches the page policy: the
 *  one place on the site with 'wasm-unsafe-eval', which a worker takes from its own response
 *  (public/_headers). */
export const SOLVER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The solver's policy in a build from before 2026-10-25, which sent it beside
 *  LEGACY_HEADER_POLICY: the three directives frame-ancestors joined it without (ADR 0018). */
export const LEGACY_SOLVER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

/** The name public/_headers adds to Vary on every response, so a cache between the site and a
 *  reader keeps a compressed copy apart from the plain one (delivery.md, "Config as code"). */
export const VARY = 'accept-encoding';

/** The request headers a Vary value names, lowercased, in order. */
export function varyNames(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

/** Content-hashed bundles under /_astro/ (delivery.md, "Config as code"). */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cloudflare's default for HTML and other unhashed assets: revalidate on every view. */
export const REVALIDATE = 'public, max-age=0, must-revalidate';
