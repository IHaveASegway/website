// The Route Lab's eager script, the only module the page loads before a visitor touches the demo
// (ADR 0016, budget: within the 5 KB of eager JavaScript every page has). The controls show by CSS
// wherever script runs, so a visitor without JavaScript never meets one that does nothing and
// nothing moves when this arrives. It turns a tap on either map into the nearest place's
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
  // CSS shows the controls from the first paint wherever script runs (route-lab.css, the
  // scripting media feature); this only covers a browser too old to know that feature.
  for (const part of root.querySelectorAll('[data-rl-nojs]')) part.setAttribute('hidden', '');
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
    if (input.closest('[data-rl-cube]')) return; // the cube's own controls plan nothing
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

  // The space-time cube (ADR 0019): three.js, about 140 KB, loads on intent at the cube itself, a
  // mouse over it, a focus or a press inside it, and never on a scroll. The app loads with it,
  // since the cube draws the app's plans. A press of Play before it arrives is kept for it.
  const cube = root.querySelector<HTMLElement>('[data-rl-cube]');
  if (cube) {
    let cubed: Promise<unknown> | undefined;
    let live = false;
    const open = () => {
      start();
      cubed ??= import('./cube')
        .then((scene) => {
          live = scene.start(root);
          if (!live)
            for (const part of cube.querySelectorAll<HTMLElement>('[data-rl-cube-controls]'))
              part.hidden = true;
        })
        .catch(() => {
          cubed = undefined;
        });
    };
    cube.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'touch') open();
    });
    cube.addEventListener('focusin', open);
    cube.addEventListener('pointerdown', open);
    cube.addEventListener('input', open);
    cube.addEventListener('click', (event) => {
      const play = event.target instanceof Element && event.target.closest('[data-rl-cube-play]');
      if (play instanceof HTMLElement && !live) {
        play.dataset['rlCubeWant'] = '1';
        open();
      }
    });
  }
}
