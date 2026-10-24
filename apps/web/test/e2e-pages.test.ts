import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ORIGIN, pagesFor, pagesIn, sitemapPages, WRITING_FIXTURE_PAGES } from '../e2e/expected';
import { app } from './support/dist';

// The pages each Playwright run walks (e2e/expected.ts, pagesFor), with a known answer for every
// context CI runs it in: the e2e job, the deploy job's smoke of the Version URL, prod-smoke in the
// attempt that promoted, and prod-smoke anywhere else. The builds are the fixture builds, so the
// answers do not depend on today's posts.

const many = join(app, '.fixtures/fixture-many');
const nonePreview = join(app, '.fixtures/fixture-none-preview');

describe('pagesIn: the indexable pages a build holds', () => {
  test("a production build's pages are the ones it lists", () => {
    expect(pagesIn(many)).toEqual([...WRITING_FIXTURE_PAGES].sort());
  });

  test('a preview with nothing published walks Home alone: its drafts are noindex', () => {
    expect(pagesIn(nonePreview)).toEqual(['/']);
  });
});

describe('pagesFor, per context', () => {
  test('the e2e job, on a preview or on wrangler dev: the build it downloaded to apps/web/dist', () => {
    for (const target of ['worker-preview', 'wrangler-dev']) {
      const env = { GITHUB_JOB: 'e2e', E2E_TARGET: target, BASE_URL: 'https://pr-6.example.dev' };
      expect(pagesFor(env, many), target).toEqual(pagesIn(many));
    }
  });

  test("the writing fixture run: the fixture's pages, whatever else is set", () => {
    const env = { E2E_SITE: 'writing-fixture', DIST_DIR: nonePreview, E2E_TARGET: 'production' };
    expect(pagesFor(env, undefined)).toBe(WRITING_FIXTURE_PAGES);
  });

  test("the deploy job's smoke of the Version URL: the build it is about to promote", () => {
    const env = { GITHUB_JOB: 'deploy', BASE_URL: 'https://abc.ihaveasegway-web.workers.dev' };
    expect(pagesFor(env, many)).toEqual(pagesIn(many));
  });

  test('prod-smoke, in the attempt that promoted: the build it deployed, DIST_DIR', () => {
    const env = { GITHUB_JOB: 'prod-smoke', E2E_TARGET: 'production', DIST_DIR: many };
    expect(pagesFor(env, undefined)).toEqual(pagesIn(many));
  });

  test("prod-smoke re-run, after a rollback, or on a stopped weekly rebuild: production's sitemap", () => {
    const env = {
      GITHUB_JOB: 'prod-smoke',
      E2E_TARGET: 'production',
      DIST_DIR: '', // what ci.yml passes outside the attempt that promoted
      PRODUCTION_PAGES: JSON.stringify(['/', '/writing/', '/writing/a-post/']),
    };
    // A build left on disk is not what production serves, so it is never read.
    expect(pagesFor(env, many)).toEqual(['/', '/writing/', '/writing/a-post/']);
  });

  test('prod-smoke with neither its build nor the sitemap fails instead of walking fewer pages', () => {
    const env = { GITHUB_JOB: 'prod-smoke', E2E_TARGET: 'production', DIST_DIR: '' };
    expect(() => pagesFor(env, many)).toThrow(/PRODUCTION_PAGES/);
  });

  test('a page list must be paths in the slash form, Home among them', () => {
    const production = (list: unknown) => ({
      E2E_TARGET: 'production',
      PRODUCTION_PAGES: JSON.stringify(list),
    });
    expect(() => pagesFor(production([]), undefined)).toThrow(/Home/);
    expect(() => pagesFor(production(['/writing/']), undefined)).toThrow(/Home/);
    expect(() => pagesFor(production(['/', '/writing']), undefined)).toThrow(/page list/);
    expect(() => pagesFor(production(['/', 'https://x.test/']), undefined)).toThrow(/page list/);
  });

  test('a run with no build at all fails, naming the build step', () => {
    expect(() => pagesFor({ GITHUB_JOB: 'e2e' }, undefined)).toThrow(/pnpm build/);
  });
});

describe("sitemapPages: production's own sitemap", () => {
  const index = (...sitemaps: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex>${sitemaps
      .map((s) => `<sitemap><loc>${s}</loc></sitemap>`)
      .join('')}</sitemapindex>`;
  const urlset = (...urls: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls
      .map((u) => `<url><loc>${u}</loc></url>`)
      .join('')}</urlset>`;
  const fetchFrom = (site: Record<string, string>) => async (url: string) => {
    const body = site[url];
    if (body === undefined) throw new Error(`${url} answered 404`);
    return body;
  };

  test('the index, then every sitemap it names, sorted and once each', async () => {
    const site = {
      [`${ORIGIN}/sitemap-index.xml`]: index(`${ORIGIN}/sitemap-0.xml`, `${ORIGIN}/sitemap-1.xml`),
      [`${ORIGIN}/sitemap-0.xml`]: urlset(`${ORIGIN}/writing/`, `${ORIGIN}/`),
      [`${ORIGIN}/sitemap-1.xml`]: urlset(`${ORIGIN}/writing/a-post/`, `${ORIGIN}/`),
    };
    expect(await sitemapPages(ORIGIN, fetchFrom(site))).toEqual([
      '/',
      '/writing/',
      '/writing/a-post/',
    ]);
  });

  test('a URL off the origin, an empty sitemap or a missing one fails', async () => {
    const offOrigin = {
      [`${ORIGIN}/sitemap-index.xml`]: index(`${ORIGIN}/sitemap-0.xml`),
      [`${ORIGIN}/sitemap-0.xml`]: urlset(`${ORIGIN}/`, 'https://www.ihaveasegway.com/a/'),
    };
    await expect(sitemapPages(ORIGIN, fetchFrom(offOrigin))).rejects.toThrow(/off/);
    const empty = {
      [`${ORIGIN}/sitemap-index.xml`]: index(`${ORIGIN}/sitemap-0.xml`),
      [`${ORIGIN}/sitemap-0.xml`]: urlset(),
    };
    await expect(sitemapPages(ORIGIN, fetchFrom(empty))).rejects.toThrow(/Home/);
    const missing = { [`${ORIGIN}/sitemap-index.xml`]: index(`${ORIGIN}/sitemap-0.xml`) };
    await expect(sitemapPages(ORIGIN, fetchFrom(missing))).rejects.toThrow(/404/);
  });

  test('a real sitemap reads back as the pages of its build', async () => {
    const site = (path: string) => readFileSync(join(many, new URL(path).pathname), 'utf8');
    expect(await sitemapPages(ORIGIN, async (url) => site(url))).toEqual(pagesIn(many));
  });
});

test('prod-smoke reads the sitemap in its global setup, before any spec loads', () => {
  const config = readFileSync(join(app, 'playwright.prod.config.ts'), 'utf8');
  expect(config).toContain("globalSetup: './e2e/production-pages.ts'");
  const setup = readFileSync(join(app, 'e2e/production-pages.ts'), 'utf8');
  expect(setup).toContain("process.env['E2E_TARGET'] = 'production';");
  expect(setup).toContain("process.env['PRODUCTION_PAGES'] = JSON.stringify(pages);");
});
