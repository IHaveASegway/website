// A lab's demo is running when a visitor lands on it (ADR 0030). This is the eager part, read by each
// lab's boot script: whether this visitor gets that, and the one choice every page shares. They don't
// if they asked for less motion, or to save data, or pressed Pause earlier in this tab, on a lab or
// with Home's button (scripts/motion.js, the same key). A page they land on still stands as the
// build drew it, and Run is one press away.

const KEY = 'motion';

export function landsRunning(): boolean {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (connection?.saveData) return false;
  try {
    return sessionStorage.getItem(KEY) !== 'paused';
  } catch {
    return true;
  }
}

/** A press of Run or Pause, kept for the tab. */
export function keepChoice(paused: boolean): void {
  try {
    if (paused) sessionStorage.setItem(KEY, 'paused');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: the choice lasts until the page is left.
  }
}

/** Runs `work` once the page has loaded and the main thread is idle, so a demo never holds up the
 *  page it stands on. */
export function whenSettled(work: () => void): void {
  const idle = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(work);
    else setTimeout(work, 1);
  };
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}
