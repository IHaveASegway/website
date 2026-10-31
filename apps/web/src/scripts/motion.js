// The motion an index carries (design-system.md, "Motion"), on Home and the indexes only
// (components/Motion.astro). Two things, both only with no reduced-motion preference:
//
// - Home's scene (ADR 0024), whose module loads only where its canvas is.
// - The title a visitor follows becomes the next page's title, a cross-document view transition.
//   Each page's <h1> carries the name in the stylesheet; as the page is left, the followed title
//   takes the name and the page's own <h1> gives it up, since a document may hold a name once.
//
// Text never animates (ADR 0025): a card's tag no longer decodes, and no title rises.

/**
 * The title that leads to `path` among `links`, each a link's pathname and its title, or null. A
 * page lists a target once, so the first match is the only one.
 */
export function titleFor(links, path) {
  return links.find((link) => link.path === path)?.title ?? null;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Runs `work` once the page has loaded and the main thread is idle. */
function whenSettled(work) {
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(work) : setTimeout(work, 1));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}

function boot() {
  // Home's scene (ADR 0024): its module loads only where its canvas is, after the page has
  // painted, and never under a reduced-motion preference or Save-Data. Where it cannot run, the
  // picture the build drew stays.
  const scene = document.querySelector('[data-scene-live]');
  if (scene && !reduced() && !navigator.connection?.saveData) {
    whenSettled(() =>
      import('./route-scene.ts').then((module) => module.boot(scene)).catch(() => {}),
    );
  }

  addEventListener('pageswap', (event) => {
    const url = event.activation?.entry?.url;
    if (!event.viewTransition || !url) return;
    const links = [...document.querySelectorAll('.card, .post-title')].flatMap((item) => {
      const link = item.querySelector('.card-more, a[href]');
      const title = item.classList.contains('card') ? item.querySelector('.card-title') : item;
      return link && title ? [{ path: new URL(link.href).pathname, title }] : [];
    });
    const title = titleFor(links, new URL(url).pathname);
    if (!title) return;
    for (const heading of document.querySelectorAll('.page-title')) {
      heading.style.viewTransitionName = 'none';
    }
    title.style.viewTransitionName = 'page-title';
  });
}

if (typeof document !== 'undefined') boot();
