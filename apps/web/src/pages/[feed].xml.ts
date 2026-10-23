import rss from '@astrojs/rss';
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadProfile, loadWritingArea } from '../lib/content';
import { feedItems } from '../lib/posts';
import { ORIGIN } from '../lib/site';

// /rss.xml: essays and notes, published ones only, newest first (content.md, "Sitemap and phases").
// A dynamic route, because a file named rss.xml.ts would always build: this one builds only while
// Writing renders. Summaries, not full text, for now. No lastBuildDate, so the same posts always
// make the same bytes, whatever day the build runs.
export const getStaticPaths = (async () => {
  const area = await loadWritingArea();
  return area.visible ? [{ params: { feed: 'rss' } }] : [];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async () => {
  const { name } = (await loadProfile()).basics;
  return rss({
    title: name,
    description: `Essays and field notes by ${name}.`,
    site: ORIGIN,
    trailingSlash: true,
    items: feedItems(await loadWritingArea()),
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    // The feed names its own URL, as the W3C validator recommends.
    customData: `<language>en</language><atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>`,
  });
};
