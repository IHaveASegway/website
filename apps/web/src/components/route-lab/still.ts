import { boxFor } from '../../lib/route-lab/space-time';
import { cubeLine, cubeName, stillMarkup } from '../../lib/route-lab/still';
import { tracks } from '../../lib/route-lab/timeline';
import type { PlansDetail } from './app';

// The space-time cube's pictures and the words over them, on the plans the maps show (ADR 0019), so
// the cube never shows another day than the maps. A view of 'rl:plans', like the 3D scene, and it
// needs no WebGL and no load at the cube: a finger loads three.js only with a tap there, and a
// browser with no WebGL never does, and until 2026-11-02 both kept the opening day's picture and
// figures under another day's maps. The app loads this on the first change, since until then the
// build's picture is the plan on show. Under the canvas, once that has come, the picture stays on
// the plans too, ready if the canvas goes (cube.ts). The picture is a part of the cube, and counts
// in the cube's budget (test/support/measure.ts).

/** Draws one plan's picture and words. */
function draw(root: HTMLElement, detail: PlansDetail): void {
  const { data, leg, dealt, solved, fresh } = detail;
  const drawn = { before: tracks(data, leg, dealt), after: tracks(data, leg, solved) };
  const backOf = (which: 'before' | 'after') =>
    Math.max(0, ...drawn[which].map((track) => track.back));
  const box = boxFor(data.viewBox, Math.max(backOf('before'), backOf('after')));
  for (const which of ['before', 'after'] as const) {
    const cube = root.querySelector(`[data-rl-cube-plan="${which}"]`);
    if (!cube) continue;
    const stale = which === 'after' && !fresh;
    const set = (selector: string, text: string) => {
      const node = cube.querySelector(selector);
      if (node) node.textContent = text;
    };
    const day = cube.querySelector('[data-rl-cube-day]');
    if (day) day.innerHTML = stillMarkup(data, drawn[which], box);
    set('[data-rl-cube-back]', cubeLine(backOf(which), stale));
    set('title', cubeName(which, backOf(which), stale));
  }
  root.querySelector('[data-rl-cube-time]')?.setAttribute('max', String(box.seconds));
}

/** Follows the app's plans from here on: on the next frame and once, however many arrived, so the
 *  change that made them answers first. */
export function follow(root: HTMLElement): void {
  let pending: PlansDetail | null = null;
  root.addEventListener('rl:plans', (event) => {
    const first = pending === null;
    pending = (event as CustomEvent<PlansDetail>).detail;
    if (first)
      requestAnimationFrame(() => {
        if (pending) draw(root, pending);
        pending = null;
      });
  });
}
