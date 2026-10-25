import type { APIRoute, GetStaticPaths } from 'astro';
import { loadLabArea, loadProfile } from '../../../lib/content';
import type { LabEntry } from '../../../lib/lab';
import { labCard, labIndexCard, renderOg } from '../../../lib/og';
import { demoPicture } from '../../../lib/route-lab/og-map';

// The link previews of /lab/ and of each demo's page, beside each page, built only when it is. A
// demo's card carries a picture of the demo when it has one (lib/route-lab/og-map.ts). Astro's
// root is the working directory (node-solver.ts).
export const getStaticPaths = (async () => {
  const lab = await loadLabArea();
  if (!lab.visible) return [];
  return [
    { params: { page: undefined }, props: { entry: null } },
    ...lab.entries.map((entry) => ({ params: { page: entry.slug }, props: { entry } })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ entry: LabEntry | null }> = async ({ props }) => {
  const card = props.entry ? labCard(props.entry) : labIndexCard(await loadProfile());
  const picture = props.entry ? await demoPicture(props.entry.slug, process.cwd()) : undefined;
  const png = await renderOg(card, picture);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
