// The Route Lab's eager script, the only module the page loads before a visitor touches the demo
// (ADR 0016, budget: within the 5 KB of eager JavaScript every page has). The controls show by CSS
// wherever script runs, so a visitor without JavaScript never meets one that does nothing and
// nothing moves when this arrives. It turns a tap on either map into the nearest place's
// checkbox; and loads the rest in two steps. The app and the route data, about 60 KB, load when
// the visitor shows intent: a focus inside the demo, a mouse over it, or a change. The solver,
// about 350 KB, loads only when VROOM has something to plan (app.ts). A touch that only scrolls
// the page loads nothing.

import { sayUnloaded, tryAgain } from '../../lib/lab/unloaded';

const LOADING = 'Loading the solver…';

/** The order checkbox nearest a point on a map, within 24 px, or null: the map's targets are the
 *  places, and the list of places is the same control for the keyboard. */
function nearest(root: HTMLElement, map: SVGSVGElement, x: number, y: number) {
  const ctm = map.getScreenCTM() as DOMMatrix; // a map under a pointer is drawn
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
  const status = root.querySelector('[data-rl-status]');

  // The vans drive when a visitor lands (ADR 0030), by the page's own markup: no script runs them,
  // this only holds them, on a button, or while the maps are off the screen.
  const maps = root.querySelector('.rl-maps') as Element;
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-rl-drive]');
  // Still until the chrome's module says the page may move (scripts/field.js), and for good if it
  // never does.
  let wanted = false;
  let shown = true;
  const drive = () => {
    for (const layer of root.querySelectorAll<SVGSVGElement>('[data-rl-fleet]')) {
      if (wanted && shown) layer.unpauseAnimations();
      else layer.pauseAnimations();
    }
    for (const button of buttons) {
      button.textContent = wanted ? 'Pause' : 'Run';
      button.setAttribute('aria-label', wanted ? 'Pause the vans' : 'Run the vans');
      button.dataset['lamp'] = wanted ? 'on' : 'off';
    }
  };
  drive();
  for (const button of buttons)
    button.addEventListener('click', () => {
      wanted = !wanted;
      drive();
    });
  // The top bar's button reaches the vans too, as it does a lab's run.
  document.addEventListener('motionchange', (event) => {
    wanted = !(event as CustomEvent<{ paused: boolean }>).detail.paused;
    drive();
  });
  new IntersectionObserver(([entry]) => {
    shown = Boolean(entry?.isIntersecting);
    drive();
  }).observe(maps);

  // What the visitor changes before the rest has loaded, in order, so nothing is lost: a control,
  // or the surprise. Which map a phone shows is not a change to the plan.
  const queued: Element[] = [];
  let ready = false;
  let failed = false;
  let started: Promise<void> | undefined;
  // A load that fails (a dropped connection, or a deploy that retired the files this page names) says
  // so on the screen, and the next change fetches a fresh page (lib/lab/unloaded.ts): importing the
  // file again can't work in WebKit, and a deploy's new files have other names. A focus or a mouse
  // over the demo does not, so a failure costs one try per change, not one per movement.
  const start = () => {
    started ??= import('./app')
      .then((app) => app.start(root, queued, nearest))
      .then(() => {
        ready = true;
      })
      .catch(() => {
        failed = true;
        sayUnloaded(root);
      });
  };
  const change = (element: Element) => {
    if (failed) return tryAgain(root);
    if (!ready) {
      queued.push(element);
      (status as Element).textContent = LOADING;
    }
    start();
  };

  root.addEventListener('focusin', start);
  root.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch') start();
  });
  root.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    // Nor do the cube's own controls: they plan nothing.
    if (input.name !== 'rl-view' && !input.closest('[data-rl-cube]')) change(input);
  });
  root.addEventListener('click', (event) => {
    const target = event.target as Element;
    const surprise = target.closest('[data-rl-surprise]');
    if (surprise) return change(surprise);
    // A tap on a map toggles the order of the nearest place, through its checkbox, so the map
    // and the list are one control.
    const map = target.closest<SVGSVGElement>('svg[data-rl-map]');
    if (map) nearest(root, map, event.clientX, event.clientY)?.click();
  });

  // The space-time cube (ADR 0019): three.js, about 140 KB, loads on intent at the cube itself, a
  // mouse over it, a focus inside it, a click or a tap, a finger's drag sideways, a touch of its
  // slider, and never on a scroll: a finger that lands on the cube to scroll fires no click, and
  // the browser takes a drag up or down for itself and cancels the pointer (touch-action,
  // route-lab.css). The app loads with it, since the cube draws the app's plans, and the cube starts
  // only once the app has started: an app that failed leaves the pictures, and the next press brings
  // a fresh page. A press of Play is kept for it.
  const cube = root.querySelector<HTMLElement>('[data-rl-cube]');
  if (cube) {
    // Each cube is a stop for Tab from the first paint, before three.js is here: the focus is the
    // intent that loads it, and the keys that turn it reach the same element once it has. Until
    // 2026-10-31 only the canvas took focus, and it arrives after the focus that loads it has
    // already passed, so Tab skipped both cubes. Script sets it, so without script there is no
    // stop that does nothing; cube.ts takes it away again where the cube cannot be drawn.
    for (const stage of cube.querySelectorAll<HTMLElement>('[data-rl-cube-stage]')) {
      stage.tabIndex = 0;
      stage.setAttribute('aria-describedby', 'rl-cube-hint');
      // A finger's drag sideways is what the hint under the cube asks for, and it fires no click:
      // until 2026-11-02 it did nothing until a tap had loaded the scene. Once a drag, as a press is.
      // Up or down is the browser's, which cancels the pointer as soon as it starts to scroll.
      let from = NaN;
      stage.addEventListener('pointerdown', (event) => {
        from = event.clientX;
      });
      stage.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' && Math.abs(event.clientX - from) > 10) {
          from = NaN;
          open(true);
        }
      });
    }
    let cubed: Promise<unknown> | undefined;
    let live = false;
    // A mouse or a focus does not try again after a failed load; a click, a tap or the slider
    // does, as a change does for the maps: one try per press, not one per movement.
    const open = (again = false) => {
      if (failed) {
        if (again) tryAgain(root);
        return;
      }
      start();
      cubed ??= Promise.all([import('./cube'), started])
        .then(([scene]) => {
          if (!ready) return;
          live = scene.start(root);
          // No WebGL here: the pictures stay, and so does the visitor's focus.
          if (!live) scene.hideControls(cube);
        })
        .catch(() => {
          cubed = undefined;
        });
    };
    cube.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'touch') open();
    });
    cube.addEventListener('focusin', () => open());
    cube.addEventListener('input', () => open(true));
    cube.addEventListener('click', (event) => {
      const play = (event.target as Element).closest<HTMLElement>('[data-rl-cube-play]');
      if (play && !live) play.dataset['rlCubeWant'] = '1';
      open(true);
    });
  }
}
