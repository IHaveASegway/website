import type { APIRoute } from 'astro';
import { loadLabArea } from '../../../lib/content';
import { leg, routeData, routeLabPicture } from '../../../lib/route-lab/picture';
import { sceneOf, sceneText } from '../../../lib/route-lab/scene';

// /lab/routes/scene.json: Home's scene (ADR 0024), the Route Lab's default day as VROOM plans it at
// build, which src/scripts/route-scene.ts fetches once Home has painted. It is written beside the
// demo it shows, since the Route Lab owns this data and Home only reads a view of it, and only
// where the demo builds: a build without the Route Lab has no scene, and Home draws none.
export async function getStaticPaths() {
  const lab = await loadLabArea();
  return lab.entries
    .filter((entry) => entry.slug === 'routes')
    .map((entry) => ({ params: { demo: entry.slug } }));
}

export const GET: APIRoute = async () => {
  // Astro's root is the working directory (lib/route-lab/node-solver.ts).
  const picture = await routeLabPicture(process.cwd());
  return new Response(sceneText(sceneOf(routeData, leg, picture.after)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
