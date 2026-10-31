// The motion an index carries (design-system.md, "Motion"), on Home and the indexes only
// (components/Motion.astro). Two things, both only with no reduced-motion preference:
//
// - Home's scene (ADR 0024), whose module loads only where its canvas is, and the board's day,
//   which runs and pauses with it.
// - The title a visitor follows becomes the next page's title, a cross-document view transition.
//   Each page's <h1> carries the name in the stylesheet; as the page is left, the followed title
//   takes the name and the page's own <h1> gives it up, since a document may hold a name once.
//
// Text never animates (ADR 0025): a card's tag no longer decodes, and no title rises.

/**
 * The title that leads to `path` among `links`, each a link's element, its pathname and its title,
 * or null: the one whose link was followed, when the visitor followed one of them, since Home
 * opens the Route Lab from its chapter and from the board; otherwise the first.
 * @param {unknown} [followed] the link the visitor followed, if any
 */
export function titleFor(links, path, followed = null) {
  const leading = links.filter((link) => link.path === path);
  return (leading.find((link) => link.element === followed) ?? leading[0])?.title ?? null;
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

  // The link a press or a key followed, so the title beside it is the one that flies.
  let followed = null;
  addEventListener('click', (event) => {
    followed = event.target instanceof Element ? event.target.closest('a[href]') : null;
  });

  // Each row that leads to a page, its link and its title: a card's, a post's, a band of the
  // board's, whose title is its link, and the Route Lab's chapter on Home.
  const ROWS = [
    { row: '.card', link: '.card-more', title: '.card-title' },
    { row: '.post-title', link: 'a[href]', title: null },
    { row: '.band', link: '.band-title', title: '.band-title' },
    { row: '.chapter', link: '.chapter-link', title: '.chapter-title' },
  ];

  addEventListener('pageswap', (event) => {
    const url = event.activation?.entry?.url;
    if (!event.viewTransition || !url) return;
    const links = ROWS.flatMap(({ row, link, title }) =>
      [...document.querySelectorAll(row)].flatMap((item) => {
        const element = item.querySelector(link);
        const words = title ? item.querySelector(title) : item;
        return element && words
          ? [{ element, path: new URL(element.href).pathname, title: words }]
          : [];
      }),
    );
    const title = titleFor(links, new URL(url).pathname, followed);
    if (!title) return;
    for (const heading of document.querySelectorAll('.page-title')) {
      heading.style.viewTransitionName = 'none';
    }
    title.style.viewTransitionName = 'page-title';
  });
}

if (typeof document !== 'undefined') boot();
