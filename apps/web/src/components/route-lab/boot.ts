// The Route Lab's eager script, the only module the page loads before a visitor touches the demo
// (ADR 0016, budget: within the 5 KB of eager JavaScript every page has). It shows the controls,
// which the markup hides so a visitor without JavaScript never meets one that does nothing, and
// hides the line written for that visitor; turns a tap on either map into the nearest place's
// checkbox; and loads the rest in two steps. The app and the route data, about 60 KB, load when
// the visitor shows intent: a focus inside the demo, a mouse over it, or a change. The solver,
// about 350 KB, loads only when VROOM has something to plan (app.ts). A touch that only scrolls
// the page loads nothing.

const UNLOADED =
  'The demo did not load, so the maps still show the day it opened with. Change anything to try again.';
const LOADING = 'Loading the solver…';

/** The order checkbox nearest a point on a map, within 24 px, or null: the map's targets are the
 *  places, and the list of places is the same control for the keyboard. */
function nearest(root: HTMLElement, map: SVGSVGElement, x: number, y: number) {
  const ctm = map.getScreenCTM();
  if (!ctm) return null;
  const at = new DOMPoint(x, y).matrixTransform(ctm.inverse());
  let found: HTMLInputElement | null = null;
  let best = (24 / ctm.a) ** 2;
  for (const box of root.querySelectorAll<HTMLInputElement>('input[name="rl-order"]')) {
    const d = (Number(box.dataset['x']) - at.x) ** 2 + (Number(box.dataset['y']) - at.y) ** 2;
    if (d < best) [found, best] = [box, d];
  }
  return found;
}

export type Nearest = typeof nearest;

const root = document.getElementById('route-lab');

if (root) {
  for (const part of root.querySelectorAll('[data-rl-js]')) part.removeAttribute('hidden');
  for (const part of root.querySelectorAll('[data-rl-nojs]')) part.setAttribute('hidden', '');
  root.setAttribute('data-rl-live', '');
  const status = root.querySelector('[data-rl-status]');

  // What the visitor changes before the rest has loaded, in order, so nothing is lost: a control,
  // or the surprise. Which map a phone shows is not a change to the plan.
  const queued: Element[] = [];
  let ready = false;
  let failed = false;
  let started: Promise<void> | undefined;
  // A load that fails (a dropped connection, or a deploy that retired the files this page names)
  // is not kept: the next change tries again. A focus or a mouse over the demo does not, so a
  // failure costs one request per change, not one per movement.
  const start = () => {
    started ??= import('./app')
      .then((app) => app.start(root, queued, nearest))
      .then(() => {
        ready = true;
        failed = false;
      })
      .catch(() => {
        started = undefined;
        failed = true;
        if (status) status.textContent = UNLOADED;
      });
  };
  const queue = (element: Element) => {
    if (ready) return;
    queued.push(element);
    if (status) status.textContent = LOADING;
  };

  root.addEventListener('focusin', () => {
    if (!failed) start();
  });
  root.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch' && !failed) start();
  });
  root.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name === 'rl-view') return;
    queue(input);
    start();
  });
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const surprise = target?.closest('[data-rl-surprise]');
    if (surprise) {
      queue(surprise);
      start();
      return;
    }
    // A tap on a map toggles the order of the nearest place, through its checkbox, so the map
    // and the list are one control.
    const map = target?.closest('svg[data-rl-map]');
    if (map instanceof SVGSVGElement) nearest(root, map, event.clientX, event.clientY)?.click();
  });
}
