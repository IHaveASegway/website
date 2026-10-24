// The robots tag that keeps a page out of search results, as one string: the page that writes it
// and every check that reads it share these bytes, so they cannot drift apart. Base.astro writes
// it on the 404 and on a draft (lib/posts.ts). The sitemap's page check
// (astro.config.mjs), the deploy guard (scripts/deploy-guard.mjs), e2e's page lists and the unit
// tests read it from here. Plain JavaScript, so the config and a script that node runs in the
// deploy job import it as the tests do.

/** The robots meta tag a noindex page carries, as it appears in the built HTML. */
export const NOINDEX = '<meta name="robots" content="noindex">';

/**
 * Whether a built page asks to stay out of search results.
 * @param {string} html
 * @returns {boolean}
 */
export const isNoindex = (html) => html.includes(NOINDEX);
