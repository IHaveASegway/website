import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, PAGES } from './expected';

// Zero Content Security Policy violations, from the browser's own event and from the console
// (security.md, "What CI checks"). Enforced from the first deploy, with no Report-Only phase.

/** Collects every violation the page reports, from its event and from the console. */
async function watch(page: Page): Promise<() => Promise<string[]>> {
  const fromConsole: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) fromConsole.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  return async () => {
    // Violation events are queued as tasks; let them land before reading.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const fromEvent = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    return [...fromEvent, ...fromConsole];
  };
}

for (const path of [...PAGES, NOT_FOUND_PAGE]) {
  test(`no CSP violation on ${path}`, async ({ page }) => {
    const violations = await watch(page);
    await page.goto(path, { waitUntil: 'load' });
    expect(await violations()).toEqual([]);
  });
}

// The known answer: if the policy were missing or loose, the test above would pass for the wrong
// reason. An inline script injected after load must be refused, and reported.
test('the page policy is enforced: an injected inline script is refused', async ({ page }) => {
  const violations = await watch(page);
  await page.goto('/', { waitUntil: 'load' });
  const ran = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'document.documentElement.dataset.injected = "ran"';
    document.head.append(script);
    return document.documentElement.dataset.injected === 'ran';
  });
  expect(ran).toBe(false);
  expect((await violations()).join('\n')).toContain('script-src');
});

// The theme script runs in <head>, before the policy's <meta>, so the policy does not govern it:
// test/csp.test.ts allows exactly that script there, byte for byte. Everything after the <meta> is
// governed. A copy of the theme script with one byte changed, placed after the policy, must be
// refused: proof that the policy checks hashes, not merely that it is present.
test('after the policy, a theme script with one byte changed is refused', async ({ page }) => {
  const violations = await watch(page);
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const original = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      expect(original).toContain('Pre-paint theme');
      // One byte changed, plus a marker, so the page shows whether the copy ran.
      const tampered = `${original.replace('Pre-paint theme', 'Pre-paint themE')};document.documentElement.setAttribute('data-tampered', '');`;
      const changed = html.replace('<body', `<script>${tampered}</script><body`);
      expect(changed).not.toBe(html);
      await route.fulfill({ response, body: changed });
    },
  );
  await page.goto('/', { waitUntil: 'load' });
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-tampered'))).toBe(
    false,
  );
  expect((await violations()).join('\n')).toContain('script-src');
});

// No request leaves the site's origin: stage A loads nothing from another origin, and the Web
// Analytics beacon's exact path joins this check in the change that ships it. The policy does not
// cover this alone: it governs only what follows its <meta>, and no directive stops a preconnect
// (test/csp.test.ts scans the markup for those). This watches what Chromium actually asks for.
async function requestsOffOrigin(page: Page, path: string, base: string): Promise<string[]> {
  const origin = new URL(base).origin;
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && new URL(url).origin !== origin) seen.push(url);
  });
  await page.goto(path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return seen;
}

for (const path of [...PAGES, NOT_FOUND_PAGE]) {
  test(`every request ${path} makes stays on the site's origin`, async ({ page, baseURL }) => {
    expect(await requestsOffOrigin(page, path, baseURL ?? '')).toEqual([]);
  });
}

test('known answer: a foreign request the policy does not stop is seen', async ({
  page,
  baseURL,
}) => {
  const foreign = 'https://third-party.invalid/pixel.png';
  await page.route('https://third-party.invalid/**', (route) => route.abort());
  await page.route(
    (url) => url.pathname === '/' && url.origin === new URL(baseURL ?? '').origin,
    async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const changed = html
        .replace(/<meta http-equiv="content-security-policy"[^>]*>/i, '')
        .replace('</body>', `<img src="${foreign}" alt=""></body>`);
      expect(changed).not.toBe(html);
      await route.fulfill({ response, body: changed });
    },
  );
  expect(await requestsOffOrigin(page, '/', baseURL ?? '')).toEqual([foreign]);
});
