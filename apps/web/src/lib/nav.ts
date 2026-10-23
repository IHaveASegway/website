// The one nav manifest (design-system.md, "One nav manifest"). The header, the footer and, later,
// the command palette read it, so a page renamed in one place is renamed everywhere. Pages are
// listed before they exist; only those this build writes are linked, so the rule "an element
// renders only when its target exists" holds by construction rather than by review.

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** In the header, from 48rem up. */
  readonly header?: boolean;
  /** In the footer's link row. */
  readonly footer?: boolean;
}

export const MANIFEST: readonly NavItem[] = [
  { id: 'work', label: 'Work', href: '/work/', header: true }, // PR 4
  { id: 'about', label: 'About', href: '/about/', header: true }, // PR 4
  { id: 'colophon', label: 'Colophon', href: '/colophon/', header: true, footer: true }, // PR 3, stage B
];

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

export const headerNav = present(MANIFEST, ROUTES).filter((item) => item.header);
export const footerNav = present(MANIFEST, ROUTES).filter((item) => item.footer);
