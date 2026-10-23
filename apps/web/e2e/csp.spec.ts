import { expect, test, type Page } from '@playwright/test';
import { MISSING, PAGES } from './expected';

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

for (const path of [...PAGES, MISSING]) {
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
