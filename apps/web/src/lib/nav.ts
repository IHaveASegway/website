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
// No Résumé item either: /about/ holds the résumé since 2026-10-28, and /resume/ is a 301 to it.
export const MANIFEST: readonly NavItem[] = [
  { id: 'lab', label: 'Lab', href: '/lab/', header: true }, // from the first live demo (lib/lab.ts)
  { id: 'writing', label: 'Writing', href: '/writing/', header: true }, // PR 5, from the first post
  { id: 'about', label: 'About', href: '/about/', header: true }, // every build; the footer's line is full
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

/** The manifest items for the header or the footer. */
export function navFor(place: 'header' | 'footer', generated: Iterable<string> = []): NavItem[] {
  return navAll(generated).filter((item) => item[place]);
}

/** A page the rail lists under a header item (ADR 0022): a demo under Lab, a post under Writing.
 *  A demo names its line, the slug its colour is reached by (global.css, [data-line]), so the rail
 *  draws its lamp in that colour (ADR 0025); a post has none. */
export interface NavLeaf {
  readonly label: string;
  readonly href: string;
  readonly line?: string;
}

/** What one rail item drops down to show (ADR 0023): its leaves, newest first where they have
 *  dates, and the noun its "View all" link names, which a screen reader hears after the two words
 *  it shows. */
export interface RailGroup {
  readonly leaves: readonly NavLeaf[];
  readonly noun: string;
}

/** How many posts the rail lists under Writing, newest first; Writing's index lists them all. */
export const RAIL_POSTS = 3;

/**
 * What the rail drops down to show under each header item, by the item's id: every live demo, in
 * the lab's order, and the newest posts. Every demo, because the lab is small: a demo has no date
 * to say which are newest, and the rail lists them all until it has one (ADR 0022, "Revisit if").
 * Leaves come from the same areas the pages are built from, so a leaf's page always exists. Each
 * group closes with a link to its index, the "View all" Joseph asked for (ADR 0023).
 */
export function railLeaves(
  lab: readonly { readonly title: string; readonly href: string; readonly line?: string }[],
  posts: readonly { readonly title: string; readonly href: string }[],
): Record<string, RailGroup> {
  const leaf = ({
    title,
    href,
    line,
  }: {
    title: string;
    href: string;
    line?: string;
  }): NavLeaf => ({
    label: title,
    href,
    ...(line === undefined ? {} : { line }),
  });
  return {
    lab: { leaves: lab.map(leaf), noun: 'demos' },
    writing: { leaves: posts.slice(0, RAIL_POSTS).map(leaf), noun: 'posts' },
  };
}
