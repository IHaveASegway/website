import { expect, test } from '@playwright/test';
import { ORIGIN } from './expected';

// /llms.txt as served (content.md, "Files for crawlers"): UTF-8 text by its header, which on the
// edge only the _headers rule gives it, and every page it names answers. Not in the smoke project:
// a rollback can promote a release from before the file existed, and that release must still pass.

test('llms.txt is served as UTF-8 text, and every page it names answers 200', async ({
  request,
}) => {
  const response = await request.get('/llms.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain;\s*charset=utf-8$/i);
  const text = await response.text();
  const own = [...text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)]
    .map(([, url = '']) => url)
    .filter((url) => url.startsWith(`${ORIGIN}/`));
  expect(own.length).toBeGreaterThan(0);
  for (const url of own) {
    const page = await request.get(new URL(url).pathname, { maxRedirects: 0 });
    expect(page.status(), url).toBe(200);
  }
});
