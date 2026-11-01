// The motion an index carries (design-system.md, "Motion"), on Home and the indexes only
// (components/Motion.astro). Two things, both only with no reduced-motion preference:
//
// - Home's live picture (components/home/Orbit.astro; ADR 0028): the ring turns and the heartbeats
//   run once this marks the page (data-motion, home.css), after it has painted, and never under
//   Save-Data. The top bar's button pauses and plays them (SC 2.2.2), and the choice lasts for the
//   tab (sessionStorage key "motion"), as the theme's does.
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

const KEY = 'motion';

/** Whether the visitor paused the picture earlier in this tab. */
function storedPause() {
  try {
    return sessionStorage.getItem(KEY) === 'paused';
  } catch {
    return false;
  }
}

/** @param {boolean} paused */
function storePause(paused) {
  try {
    if (paused) sessionStorage.setItem(KEY, 'paused');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: the choice lasts until the page is left.
  }
}

/** Runs Home's live picture, with the top bar's button to pause and play it. */
function runDrawing() {
  const root = document.documentElement;
  const toggle = document.querySelector('[data-motion-toggle]');
  let paused = storedPause();
  const show = () => {
    root.dataset['motion'] = paused ? 'paused' : 'on';
    if (!toggle) return;
    const name = paused ? 'Play motion' : 'Pause motion';
    toggle.setAttribute('aria-label', name);
    toggle.setAttribute('title', name);
    toggle.dataset['state'] = paused ? 'paused' : 'on';
  };
  toggle?.addEventListener('click', () => {
    paused = !paused;
    storePause(paused);
    show();
  });
  show();
}

function boot() {
  if (document.querySelector('[data-live]') && !reduced() && !navigator.connection?.saveData)
    whenSettled(runDrawing);

  // The link a press or a key followed, so the title beside it is the one that flies.
  let followed = null;
  addEventListener('click', (event) => {
    followed = event.target instanceof Element ? event.target.closest('a[href]') : null;
  });

  // Each row that leads to a page, its link and its title: a card's and a post's.
  const ROWS = [
    { row: '.card', link: '.card-more', title: '.card-title' },
    { row: '.post-title', link: 'a[href]', title: null },
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
