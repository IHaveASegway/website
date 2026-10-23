import { existsSync, readFileSync } from 'node:fs';

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
 * Every page the site's build writes, but a draft: each URL in published-urls.txt that no 301 in
 * public/_redirects has moved. A post is published by adding its URL there (ADR 0005), so a page
 * needs that one line, not a second list here. apps/web/test/urls.test.ts fails when the ledger
 * and the build disagree, so a new page cannot skip the axe, CSP, smoke and byte-for-byte checks.
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
 * The pages of the test-only writing fixture build, .fixtures/fixture-three (scripts/build-fixtures.mjs):
 * Home, both indexes and the three published posts, and not the draft. pnpm e2e:writing walks these.
 */
export const WRITING_FIXTURE_PAGES: readonly string[] = [
  '/',
  '/notes/',
  '/notes/trailing-slashes/',
  '/writing/',
  '/writing/measure-first/',
  '/writing/retries-and-back-off/',
];

/** Which build a run checks: the site, or the writing fixture (E2E_SITE=writing-fixture). */
export const ON_WRITING_FIXTURE = process.env['E2E_SITE'] === 'writing-fixture';

/** Every page the build under test writes, which the axe, CSP, smoke and glyph checks walk. */
export const PAGES: readonly string[] = ON_WRITING_FIXTURE ? WRITING_FIXTURE_PAGES : SITE_PAGES;

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
