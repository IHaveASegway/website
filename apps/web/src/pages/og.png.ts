import type { APIRoute } from 'astro';
import { loadProfile } from '../lib/content';
import { homeCard, renderOg } from '../lib/og';

// Home's link preview, written to dist/og.png at build: beside its page, so the URL stays stable
// (ADR 0005). Base.astro writes the tags that point here from the same card.
export const GET: APIRoute = async () => {
  const png = await renderOg(homeCard(await loadProfile()));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
