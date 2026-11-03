// The app of a lab that didn't load: a dropped connection, or a deploy that retired the hashed file
// while the page was open. The picture stays as the build drew it, and the line that says what a
// press did says so, on the screen as well as to a screen reader (lib/lab/said.ts). Until 2026-11-02
// only a screen reader heard it: Run stayed Run, and nothing visible ever changed.

const UNLOADED = 'The lab did not load. Press any control to try again.';

/** Says the app did not load, in the live region and the first line on the screen. */
export function sayUnloaded(root: Element, live: Element | null): void {
  if (live) live.textContent = UNLOADED;
  const line = root.querySelector('[data-said]');
  if (line) {
    line.textContent = UNLOADED;
    line.setAttribute('data-spoke', '');
  }
}

/** Takes it back once a try has loaded the app, unless a press has spoken since. */
export function clearUnloaded(root: Element, live: Element | null): void {
  if (live?.textContent === UNLOADED) live.textContent = '';
  const line = root.querySelector<HTMLElement>('[data-said]');
  if (line?.textContent === UNLOADED) {
    line.textContent = line.dataset['said'] ?? '';
    line.removeAttribute('data-spoke');
  }
}
