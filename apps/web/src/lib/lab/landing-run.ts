// The run a visitor lands on (ADR 0030), loaded with the lab's simulation. It plays while the demo is
// on the screen, the tab is showing and motion isn't paused, and the end of a run stands a moment,
// then plays again. All of that stops at the visitor's first press, and from there the demo is
// theirs, as if they had pressed Run. While it's nobody's choice it says nothing to a screen reader:
// a live region that spoke from the moment a page opened would talk over the page. Their first press
// gives it its voice back.

import { readLink } from '../sim/link';

/** What the run does, in the lab's own words. */
export interface LandingRun {
  /** What Run does from here. */
  play(): void;
  pause(): void;
  playing(): boolean;
  /** Whether the run has nothing more to show. */
  finished(): boolean;
  /** Starts the run again. */
  again(): void;
  /** The visitor's first press has come, or a link was followed: the demo is theirs from here, so
   *  anything the run had planned to do by itself is off. */
  theirs?(): void;
}

const LOOK = 500; // real ms between looks at the run
const HOLD = 6_000; // real ms the end of a run stands before it plays again

export function runOnLanding(root: HTMLElement, run: LandingRun): void {
  const live = [...root.querySelectorAll('[role="log"], [role="status"], [aria-live]')];
  const voices = live.map((element) => element.getAttribute('aria-live'));
  for (const element of live) element.setAttribute('aria-live', 'off');

  let begun = false;
  let shown = false;
  let held = 0;

  const look = () => {
    const paused = document.documentElement.dataset['motion'] === 'paused';
    const wanted = shown && !document.hidden && !paused;
    if (!wanted) {
      // The end of a run stands only while it's wanted: going round unseen, or under the top bar's
      // Pause, would change the picture while nothing is meant to move.
      clearTimeout(held);
      held = 0;
      if (run.playing()) run.pause();
      return;
    }
    if (!begun) {
      begun = true;
      run.play();
    } else if (!run.finished()) {
      if (!run.playing()) run.play();
    } else if (!held) {
      held = window.setTimeout(() => {
        held = 0;
        run.again();
      }, HOLD);
    }
  };

  const every = window.setInterval(look, LOOK);
  const seen = new IntersectionObserver(([entry]) => {
    shown = entry?.isIntersecting ?? false;
    look();
  });
  seen.observe(root);
  document.addEventListener('visibilitychange', look);
  document.addEventListener('motionchange', look);

  const leave = () => {
    run.theirs?.();
    clearInterval(every);
    clearTimeout(held);
    seen.disconnect();
    document.removeEventListener('visibilitychange', look);
    document.removeEventListener('motionchange', look);
    root.removeEventListener('click', taken, true);
    root.removeEventListener('change', taken, true);
    root.removeEventListener('input', taken, true);
    removeEventListener('hashchange', followed);
    live.forEach((element, i) => {
      const voice = voices[i];
      if (voice) element.setAttribute('aria-live', voice);
      else element.removeAttribute('aria-live');
    });
  };
  /** A link to a run opens that run, paused, and it's theirs from there. A link to a heading only
   *  moves the page, so the run goes on as it was: it still pauses off the screen and under the top
   *  bar's Pause. No settings are read here, only whether the hash names a run at all. */
  const followed = () => {
    if (readLink(location.hash, {})) leave();
  };
  /** A press on anything that acts: a button, a choice, or a node of the Raft Lab's picture. */
  const taken = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('button, input, label, [data-rf-node]'))
      leave();
  };
  root.addEventListener('click', taken, true);
  root.addEventListener('change', taken, true);
  root.addEventListener('input', taken, true);
  addEventListener('hashchange', followed);
}
