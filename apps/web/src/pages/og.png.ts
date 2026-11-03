import type { APIRoute } from 'astro';
import { loadLabArea, loadProfile } from '../lib/content';
import { homeCard, renderOg } from '../lib/og';
import { homeArt } from '../lib/og-art';

// Home's link preview, written to dist/og.png at build: beside its page, so the URL stays stable
// (ADR 0005). Base.astro writes the tags that point here from the same card. It looks like the page
// it opens: the name beside the cluster, on the field, in black and white and one accent (ADR 0029).
// A build with no Raft Lab draws the words alone.
export const GET: APIRoute = async () => {
  const lab = await loadLabArea();
  const art = await homeArt(lab.entries.map((entry) => entry.slug));
  const png = await renderOg(homeCard(await loadProfile()), art);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
