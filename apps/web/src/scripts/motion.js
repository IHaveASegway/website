// The motion an index carries (design-system.md, "Motion"), on Home and the indexes only
// (components/Motion.astro). Two things, both only with no reduced-motion preference:
//
// - A card's tag decodes when the card is hovered or its link is focused: its letters cycle and
//   settle from the left into the word. The tag is a monospaced label, so every frame is as wide
//   as the word and nothing around it moves (no layout shift). Assistive technology reads the word
//   once, from a hidden copy; the cycling letters are hidden from it.
// - The title a visitor follows becomes the next page's title, a cross-document view transition.
//   Each page's <h1> carries the name in the stylesheet; as the page is left, the followed title
//   takes the name and the page's own <h1> gives it up, since a document may hold a name once.

/** Letters a tag cycles through: in every face subset, and as wide as any other in a mono face. */
export const GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

/** How long a tag takes to settle. */
export const DECODE_MS = 360;

/**
 * One frame of a decode: the first `progress` share of the word in place, every other letter or
 * digit replaced by `pick()`, and spaces and punctuation kept, so the frame has the word's length.
 */
export function scramble(word, progress, pick) {
  const settled = Math.floor(Math.max(0, Math.min(1, progress)) * word.length);
  return [...word]
    .map((char, i) => (i < settled || !/[\p{L}\p{N}]/u.test(char) ? char : pick()))
    .join('');
}

/**
 * The title that leads to `path` among `links`, each a link's pathname and its title, or null. A
 * page lists a target once, so the first match is the only one.
 */
export function titleFor(links, path) {
  return links.find((link) => link.path === path)?.title ?? null;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function decoder(card) {
  const tag = card.querySelector('.card-tag');
  if (!tag) return null;
  const word = tag.textContent.trim();
  let shown = null;
  let frame = 0;
  return () => {
    if (reduced()) return;
    if (!shown) {
      const hidden = document.createElement('span');
      hidden.dataset.word = '';
      hidden.textContent = word;
      shown = document.createElement('span');
      shown.setAttribute('aria-hidden', 'true');
      tag.replaceChildren(hidden, shown);
    }
    cancelAnimationFrame(frame);
    const start = performance.now();
    const pick = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    const step = (now) => {
      const progress = (now - start) / DECODE_MS;
      shown.textContent = progress >= 1 ? word : scramble(word, progress, pick);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
}

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

  // Only a card that leads somewhere reacts, as its bar does; the résumé carries no motion.
  for (const card of document.querySelectorAll('.card')) {
    const link = card.querySelector('.card-more');
    const run = link && !card.closest('.resume') ? decoder(card) : null;
    if (!run) continue;
    card.addEventListener('pointerenter', (event) => event.pointerType === 'mouse' && run());
    link.addEventListener('focus', run);
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
