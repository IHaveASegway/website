// What runs by itself on every page (ADR 0030; styles/field.css), and the one owner of the choice
// about it. Once the page has settled this marks it (data-motion), unless the visitor asked for less
// motion or to save data. The field's patch and current, the facts' signals, the glyphs' sparks and
// Home's picture all run on that mark, on their own clocks, and a scroll has nothing to do with them.
// A lab's demo and the Route Lab's vans read the mark too. The top bar's button pauses all of it (SC
// 2.2.2), and the choice lasts for the tab (sessionStorage key "motion"), as the theme's does. Each
// change fires "motionchange" on the document, with { paused }.
//
// And once for each section and each row of What I build, this says the visitor has reached it
// (data-lit): its line carries the current from then on, however they scroll after that.

const KEY = 'motion';

/** Whether the visitor paused motion earlier in this tab. */
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

function runMotion() {
  const root = document.documentElement;
  const toggle = document.querySelector('[data-motion-toggle]');
  let paused = storedPause();
  const show = () => {
    root.dataset['motion'] = paused ? 'paused' : 'on';
    if (toggle) {
      const name = paused ? 'Play motion' : 'Pause motion';
      toggle.setAttribute('aria-label', name);
      toggle.setAttribute('title', name);
      toggle.dataset['state'] = paused ? 'paused' : 'on';
    }
    document.dispatchEvent(new CustomEvent('motionchange', { detail: { paused } }));
  };
  toggle?.addEventListener('click', () => {
    paused = !paused;
    storePause(paused);
    show();
  });
  show();
}

if (
  !matchMedia('(prefers-reduced-motion: reduce)').matches &&
  !(/** @type {any} */ (navigator).connection?.saveData)
) {
  const idle = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(runMotion);
    else setTimeout(runMotion, 1);
  };
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}

/**
 * @param {string} selector what to light
 * @param {string} rootMargin how far up the window it must come first
 */
function lightOnce(selector, rootMargin) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-lit', '');
        seen.unobserve(entry.target);
      }
    },
    { rootMargin },
  );
  for (const target of document.querySelectorAll(selector)) seen.observe(target);
}

lightOnce('.section', '0px 0px -8% 0px');
lightOnce('.build', '0px 0px -38% 0px');
