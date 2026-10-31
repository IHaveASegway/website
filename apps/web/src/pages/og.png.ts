import type { APIRoute } from 'astro';
import { loadLabArea, loadProfile } from '../lib/content';
import { homeCard, renderOg } from '../lib/og';
import { boardArt } from '../lib/og-lines';

// Home's link preview, written to dist/og.png at build: beside its page, so the URL stays stable
// (ADR 0005). Base.astro writes the tags that point here from the same card. It carries the board,
// every lab's line stacked, as the page does; a build with no lab draws the words alone. Astro's
// root is the working directory (node-solver.ts).
export const GET: APIRoute = async () => {
  const lab = await loadLabArea();
  const art = await boardArt(
    lab.entries.map((entry) => entry.slug),
    process.cwd(),
  );
  const png = await renderOg(homeCard(await loadProfile()), art);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
