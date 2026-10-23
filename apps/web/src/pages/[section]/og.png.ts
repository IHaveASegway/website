import type { APIRoute, GetStaticPaths } from 'astro';
import { loadProfile, loadWritingArea } from '../../lib/content';
import { renderOg, sectionCard } from '../../lib/og';
import type { Section } from '../../lib/posts';

// The link preview of /writing/ and /notes/, beside each page, built only when the page is.
export const getStaticPaths = (async () => {
  const area = await loadWritingArea();
  return area.sections.map((section) => ({ params: { section }, props: { section } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ section: Section }> = async ({ props }) => {
  const png = await renderOg(sectionCard(props.section, await loadProfile()));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
