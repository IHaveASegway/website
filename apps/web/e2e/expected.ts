// What the site must serve. The e2e specs and the production smoke read these, so a change to a
// route or a header is one edit here, in the same pull request as the change itself.

/** The one public origin. Canonical links, the sitemap and every redirect name it. */
export const ORIGIN = 'https://ihaveasegway.com';

/**
 * Every page the build writes. The axe, CSP, smoke and byte-for-byte checks walk this list, so
 * apps/web/test/urls.test.ts fails when it and the build disagree: a new page cannot skip them.
 */
export const PAGES: readonly string[] = ['/'];

/** Files clients ask for by name, at the paths they look in (ADR 0005). */
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
