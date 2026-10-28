import type { APIRoute, GetStaticPaths } from 'astro';
import { loadAbout, loadProfile } from '../../../lib/content';
import { aboutCard, renderOg } from '../../../lib/og';

// /about/'s link preview, beside its page, built only when the page is (lib/about.ts).
export const getStaticPaths = (async () => {
  const about = await loadAbout();
  return about.built ? [{ params: { page: undefined } }] : [];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async () => {
  const png = await renderOg(aboutCard(await loadProfile()));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
