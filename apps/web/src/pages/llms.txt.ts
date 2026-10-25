import type { APIRoute } from 'astro';
import holdList from '../../not-on-site.txt?raw';
import { loadLabArea, loadProfile, loadWritingArea } from '../lib/content';
import { labRoutes } from '../lib/lab';
import { parseHolds } from '../lib/held-names';
import { llmsText } from '../lib/llms';
import { navAll } from '../lib/nav';
import { areaRoutes } from '../lib/posts';
import { projectCards } from '../lib/profile';

// /llms.txt, written to dist/ at build from the sources the pages read (lib/llms.ts). It sits in
// every scan of dist/: the hold list, the readiness check, the timestamps (content.md, "Files for
// crawlers").
export const GET: APIRoute = async () => {
  const profile = await loadProfile();
  const area = await loadWritingArea();
  const lab = await loadLabArea();
  const text = llmsText({
    profile,
    pages: navAll([...areaRoutes(area), ...labRoutes(lab)]),
    area,
    lab,
    projects: projectCards(profile, parseHolds(holdList)),
  });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
