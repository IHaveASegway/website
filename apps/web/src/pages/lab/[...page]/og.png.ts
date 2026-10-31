import type { APIRoute, GetStaticPaths } from 'astro';
import { loadLabArea, loadProfile } from '../../../lib/content';
import type { LabEntry } from '../../../lib/lab';
import { labCard, labIndexCard, renderOg } from '../../../lib/og';
import { boardArt, demoArt } from '../../../lib/og-lines';

// The link previews of /lab/ and of each demo's page, beside each page, built only when it is. A
// demo's card carries a picture of the demo (its map, or its line) and lights its lamp in the
// lab's colour; the index's carries every line, as the board does (lib/og-lines.ts). Astro's root
// is the working directory (node-solver.ts).
export const getStaticPaths = (async () => {
  const lab = await loadLabArea();
  if (!lab.visible) return [];
  const slugs = lab.entries.map((entry) => entry.slug);
  return [
    { params: { page: undefined }, props: { entry: null, slugs } },
    ...lab.entries.map((entry) => ({ params: { page: entry.slug }, props: { entry, slugs } })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ entry: LabEntry | null; slugs: readonly string[] }> = async ({
  props,
}) => {
  const app = process.cwd();
  const card = props.entry ? labCard(props.entry) : labIndexCard(await loadProfile());
  const art = props.entry ? await demoArt(props.entry.slug, app) : await boardArt(props.slugs, app);
  const png = await renderOg(card, art);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
