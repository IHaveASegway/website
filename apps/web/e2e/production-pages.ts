import { ORIGIN, sitemapPages } from './expected';

// prod-smoke's global setup (playwright.prod.config.ts), which Playwright runs before it loads any
// spec. A run that did not deploy the build it checks (a re-run, after a rollback, or on a weekly
// rebuild the guard stopped) cannot know which build is live, so it walks the pages production's
// own sitemap lists: read once, here, and handed to every worker through the environment
// (expected.ts, pagesFor). The run that promoted walks the build it deployed instead (DIST_DIR).

export default async function productionPages(): Promise<void> {
  process.env['E2E_TARGET'] = 'production';
  if (process.env['DIST_DIR']) return;
  const pages = await sitemapPages(ORIGIN, async (url) => {
    const response = await fetch(url, { redirect: 'manual' });
    if (response.status !== 200) throw new Error(`${url} answered ${response.status}`);
    return response.text();
  });
  process.env['PRODUCTION_PAGES'] = JSON.stringify(pages);
  console.log(`prod-smoke: walking the pages production's sitemap lists: ${pages.join(' ')}`);
}
