import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Every page the site publishes: each URL in published-urls.txt that no 301 in public/_redirects
 * has moved. A post is published by adding its URL there (ADR 0005). apps/web/test/urls.test.ts
 * fails when the ledger and the build disagree, so the build's pages and these are the same.
 */
export const SITE_PAGES: readonly string[] = (() => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const redirects = existsSync(new URL('../public/_redirects', import.meta.url))
    ? lines(read('../public/_redirects')).map((line) => line.split(/\s+/))
    : [];
  const moved = (url: string) =>
    redirects.some(
      ([from = '', , status]) =>
        status === '301' && (from.endsWith('*') ? url.startsWith(from.slice(0, -1)) : from === url),
    );
  return lines(read('../published-urls.txt')).filter((url) => !moved(url));
})();

/**
 * The pages of the test-only writing fixture build, .fixtures/fixture-many
 * (scripts/build-fixtures.mjs): Home, both indexes and the five published posts, and not the draft.
 * pnpm e2e:writing walks these, and test/writing.test.ts holds the build to them.
 */
export const WRITING_FIXTURE_PAGES: readonly string[] = [
  '/',
  '/notes/',
  '/notes/fixture-small-note/',
  '/notes/fixture-trailing-slashes/',
  '/writing/',
  '/writing/fixture-markdown-tour/',
  '/writing/fixture-measure-first/',
  '/writing/fixture-retries-and-back-off/',
];

/** Pages every release since launch serves: what a run checks when it cannot know which build is
 *  live (delivery.md, "Deploy, verify, roll back"). */
export const LAUNCH_PAGES: readonly string[] = ['/'];

/** Which build a run checks: the site, or the writing fixture (E2E_SITE=writing-fixture). */
export const ON_WRITING_FIXTURE = process.env['E2E_SITE'] === 'writing-fixture';

/** The indexable pages a build directory holds, read from the build itself: every index.html but
 *  a noindex one (a draft, or an unlisted post, in a preview). */
export function pagesIn(dir: string): string[] {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) => {
      const path = join(at, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(dir)
    .filter((path) => path.endsWith(`${sep}index.html`) || path === join(dir, 'index.html'))
    .filter(
      (path) => !readFileSync(path, 'utf8').includes('<meta name="robots" content="noindex">'),
    )
    .map((path) => `/${relative(dir, path).split(sep).join('/').slice(0, -'index.html'.length)}`)
    .sort();
}

/**
 * The build being served, when this run has it. prod-smoke has it only in the attempt that put it
 * live (DIST_DIR); after a rollback, or when the guarded weekly rebuild deployed nothing, production
 * may serve an older build, so prod-smoke falls back to the launch pages. The e2e and deploy jobs
 * download the build they serve to apps/web/dist, and a laptop serves its own last build there.
 */
function servedBuild(): string | undefined {
  const named = process.env['DIST_DIR'];
  if (named) return named;
  if (process.env['GITHUB_JOB'] === 'prod-smoke') return undefined;
  const local = fileURLToPath(new URL('../dist/', import.meta.url));
  return existsSync(join(local, 'index.html')) ? local : undefined;
}

/**
 * Every page the build under test serves, which the axe, CSP, smoke and glyph checks walk: read
 * from that build, so a check never asks for a page the served build lacks, and never skips one it
 * has. The fixture run walks the fixture's pages.
 */
export const PAGES: readonly string[] = ON_WRITING_FIXTURE
  ? WRITING_FIXTURE_PAGES
  : ((build) => (build ? pagesIn(build) : LAUNCH_PAGES))(servedBuild());

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

/** Response headers from public/_headers (security.md, "Headers and Content Security Policy"). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
};

/** Headers this site never sends (security.md, "Never sent"). */
export const NEVER_SENT = ['x-xss-protection', 'expect-ct', 'x-frame-options'] as const;

/** Content-hashed bundles under /_astro/ (delivery.md, "Config as code"). */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cloudflare's default for HTML and other unhashed assets: revalidate on every view. */
export const REVALIDATE = 'public, max-age=0, must-revalidate';
