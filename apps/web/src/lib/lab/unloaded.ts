// The app of a lab that didn't load: a dropped connection, or a deploy that retired the hashed file
// while the page was open. The picture stays as the build drew it, and the line that says what a
// press did says so, on the screen as well as to a screen reader (lib/lab/said.ts). Until 2026-11-02
// only a screen reader heard it: Run stayed Run, and nothing visible ever changed.

const UNLOADED = 'The lab did not load. Press any control to try again.';

/** Says the app did not load, in the live region and every line on the screen: on a phone a line
 *  under Run is over a thousand pixels from the settings, and any control there is as dead. */
export function sayUnloaded(root: Element, live: Element | null): void {
  if (live) live.textContent = UNLOADED;
  for (const line of root.querySelectorAll('[data-said]')) {
    line.textContent = UNLOADED;
    line.setAttribute('data-spoke', '');
  }
}

/**
 * A press after that. Importing the file again can't work: WebKit keeps a failed import for the life
 * of the page, and a deploy's new file has another name. Only a fresh page can load it, and WebKit
 * carries the failure through a reload in its memory cache until something fetches the file again, so
 * this fetches the page and its files first (the preload links name them). With no connection that
 * fails, and the page stays and says so again, where a reload would swap it for the browser's error.
 */
export async function tryAgain(root: Element, live: Element | null): Promise<void> {
  const files = [...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')];
  try {
    await Promise.all(
      [location.href, ...files.map((file) => file.href)].map((url) =>
        fetch(url, { cache: 'reload' }),
      ),
    );
    location.reload();
  } catch {
    sayUnloaded(root, live);
  }
}
