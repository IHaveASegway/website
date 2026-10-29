import type { APIRoute } from 'astro';
import { loadProfile } from '../../lib/content';
import { labelOf } from '../../lib/nav';
import { aboutCard, renderOg } from '../../lib/og';

// /about/'s link preview, beside its page: the name, and the page's label as the header has it.
export const GET: APIRoute = async () => {
  const png = await renderOg(aboutCard(await loadProfile(), labelOf('about')));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
