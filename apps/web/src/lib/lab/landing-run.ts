// The run a visitor lands on (ADR 0030), loaded with the lab's simulation. It plays while the demo is
// on the screen, the tab is showing and motion isn't paused, and the end of a run stands a moment,
// then plays again. All of that stops at the visitor's first press, and from there the demo is
// theirs, as if they had pressed Run. While it's nobody's choice it says nothing, on the screen or to
// a screen reader (lib/lab/said.ts, which reads this region's aria-live): a live region that spoke from
// the moment a page opened would talk over the page. Their first press gives it its voice back.

import { readLink } from '../sim/link';

/** A run's clock, in the lab's own words. */
export interface Playing {
  play(): void;
  pause(): void;
  playing(): boolean;
}

/**
 * What stops a run whoever started it, in every lab, from the moment its app arrives: a hidden tab,
 * which stops it for good, and the top bar's button. That one is the page's one choice about motion
 * (ADR 0030): its Pause stops whatever is moving, and its Play starts only what it stopped, so a run
 * the visitor paused by hand stays paused, and a press after that Pause is theirs and lets go of it.
 * Until 2026-11-03 the button let go of a run at the visitor's first press: it said Play while the
 * clock ran on. A visitor who changes their mind about less motion mid-run gets the steps or the glide
 * they asked for at once.
 */
export function heldByThePage(root: Element, run: Playing, still: MediaQueryList): void {
  let held = false;
  root.addEventListener('click', (event) => {
    if ((event.target as Element).closest(PRESSES)) held = false;
  });
  document.addEventListener('motionchange', (event) => {
    if ((event as CustomEvent<{ paused: boolean }>).detail.paused) {
      held = run.playing();
      if (held) run.pause();
    } else if (held) {
      held = false;
      run.play();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && run.playing()) run.pause();
  });
  still.addEventListener('change', () => {
    if (run.playing()) {
      run.pause();
      run.play();
    }
  });
}

/** What the run a visitor lands on does, in the lab's own words. */
export interface LandingRun extends Playing {
  /** Whether the run has nothing more to show. */
  finished(): boolean;
  /** Starts the run again. */
  again(): void;
}

/** What a press lands on: a button, a choice, or a node of the Raft Lab's picture. */
const PRESSES = 'button, input, label, [data-rf-node]';
const LOOK = 500; // real ms between looks at the run
const HOLD = 6_000; // real ms the end of a run stands before it plays again

export function runOnLanding(root: HTMLElement, run: LandingRun): void {
  // The one region that speaks: the log's own is off for good.
  const live = root.querySelector('[role="status"]') as Element;
  live.setAttribute('aria-live', 'off');

  let begun = false;
  let shown = false;
  let held: ReturnType<typeof setTimeout> | undefined;

  const look = () => {
    const paused = document.documentElement.dataset['motion'] === 'paused';
    const wanted = shown && !document.hidden && !paused;
    if (!wanted) {
      // The end of a run stands only while it's wanted: going round unseen, or under the top bar's
      // Pause, would change the picture while nothing is meant to move.
      clearTimeout(held);
      held = undefined;
      if (run.playing()) run.pause();
      return;
    }
    if (!begun) {
      begun = true;
      run.play();
    } else if (!run.finished()) {
      if (!run.playing()) run.play();
    } else if (!held) {
      held = setTimeout(() => {
        held = undefined;
        run.again();
      }, HOLD);
    }
  };

  const every = setInterval(look, LOOK);
  const seen = new IntersectionObserver(([entry]) => {
    shown = Boolean(entry?.isIntersecting);
    look();
  });
  seen.observe(root);
  const left = new AbortController();
  const { signal } = left;
  document.addEventListener('visibilitychange', look, { signal });
  document.addEventListener('motionchange', look, { signal });

  const leave = () => {
    clearInterval(every);
    clearTimeout(held);
    seen.disconnect();
    left.abort();
    live.removeAttribute('aria-live');
  };
  /** A link to a run opens that run, paused, and it's theirs from there. A link to a heading only
   *  moves the page, so the run goes on as it was: it still pauses off the screen and under the top
   *  bar's Pause. No settings are read here, only whether the hash names a run at all. */
  const followed = () => {
    if (readLink(location.hash, {})) leave();
  };
  const taken = (event: Event) => {
    if ((event.target as Element).closest(PRESSES)) leave();
  };
  for (const kind of ['click', 'change', 'input'])
    root.addEventListener(kind, taken, { capture: true, signal });
  addEventListener('hashchange', followed, { signal });
}
