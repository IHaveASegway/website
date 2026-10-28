// The one nav manifest (design-system.md, "One nav manifest"). The header, the footer and the
// command menu (components/Palette.astro) read it, so a page renamed in one place is renamed
// everywhere. Pages are listed before they exist; only those this build writes are linked, so the
// rule "an element renders only when its target exists" holds by construction rather than by
// review. Page files say which static pages exist; content says the rest (Writing's indexes and
// feed, lib/posts.ts; the lab's pages, lib/lab.ts).

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** In the header, from 48rem up. */
  readonly header?: boolean;
  /** In the footer's link row. */
  readonly footer?: boolean;
}

// No Work item: owned work is a card on Home that links to its repository, and /work/ builds
// nothing (content.md, "Owned work", 2026-10-23). Lab comes first, as content.md orders the header.
// "Résumé" is set in the sans face, which has é; the mono subset does not (design-system.md,
// "The faces").
export const MANIFEST: readonly NavItem[] = [
  { id: 'lab', label: 'Lab', href: '/lab/', header: true }, // from the first live demo (lib/lab.ts)
  { id: 'writing', label: 'Writing', href: '/writing/', header: true }, // PR 5, from the first post
  { id: 'resume', label: 'Résumé', href: '/resume/', header: true, footer: true }, // every build
  { id: 'about', label: 'About', href: '/about/', header: true }, // PR 4
  { id: 'rss', label: 'RSS', href: '/rss.xml', footer: true }, // PR 5, with Writing
  { id: 'colophon', label: 'Colophon', href: '/colophon/', header: true, footer: true }, // PR 3b
];

/** An item's label, for a page that names itself the way the nav names it: its title and its
 *  link preview say what its header link says. */
export function labelOf(id: string): string {
  const item = MANIFEST.find((i) => i.id === id);
  if (item === undefined) throw new Error(`nav.ts: the manifest has no item "${id}"`);
  return item.label;
}

/** Page URLs from page file paths: index.astro is "/", colophon/index.astro is "/colophon/". The
 *  404 page has no URL of its own, and endpoints such as og.png.ts are files, not pages. */
export function routesFrom(files: readonly string[]): Set<string> {
  const routes = new Set<string>();
  for (const file of files) {
    const path = /\/pages\/(.+)\.(?:astro|md|mdx)$/.exec(file)?.[1];
    if (path === undefined || path === '404' || path.includes('[')) continue;
    routes.add(path === 'index' ? '/' : `/${path.replace(/\/index$/, '')}/`);
  }
  return routes;
}

/** The manifest items whose page this build writes. */
export function present(manifest: readonly NavItem[], routes: ReadonlySet<string>): NavItem[] {
  return manifest.filter((item) => routes.has(item.href));
}

const ROUTES = routesFrom(Object.keys(import.meta.glob('../pages/**/*.{astro,md,mdx}')));

/** Every manifest item this build writes, header and footer alike (llms.txt reads them all), given
 *  the URLs content adds to it (lib/posts.ts, areaRoutes): a dynamic route builds a page only when
 *  its content exists. */
export function navAll(generated: Iterable<string> = []): NavItem[] {
  return present(MANIFEST, new Set([...ROUTES, ...generated]));
}

/** The manifest items for the header or the footer. Résumé is in the header until /about/ exists
 *  and in the footer from then on, so it is always one click from every page but never in both
 *  rows: the bio takes its place, and links it (lib/about.ts, Joseph's choice of 2026-10-27). */
export function navFor(place: 'header' | 'footer', generated: Iterable<string> = []): NavItem[] {
  const items = navAll(generated);
  const about = items.some((item) => item.id === 'about');
  return items.filter(
    (item) => item[place] && (item.id !== 'resume' || (place === 'header') !== about),
  );
}
