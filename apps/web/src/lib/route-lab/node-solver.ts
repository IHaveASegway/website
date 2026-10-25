import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import lock from './solver.lock.json';
import type { VroomInput, VroomOutput } from './plan';

// The solver in Node, for the build and the unit tests: the same files the site serves, imported
// from public/ where they sit, not bundled. The page draws its picture without JavaScript from this
// solve, so the figures a visitor reads before pressing anything are VROOM's own, never typed.

export interface Solver {
  readonly version: string;
  solve(input: VroomInput, options: { explorationLevel: number }): VroomOutput;
}

/** The solver folder's path in apps/web/public, from the lock (tools/vroom-wasm/install.mjs). */
export const solverDir = (app: string): string =>
  join(app, 'public', 'lab', 'routes', 'solver', lock.folder);

/** Loads VROOM from apps/web/public. `app` is apps/web: Astro's root, which astro.config.mjs
 *  leaves at the working directory, as the tests do. */
export async function loadSolver(app: string): Promise<Solver> {
  const file = join(solverDir(app), 'vroom-solver.mjs');
  if (!existsSync(file))
    throw new Error(`route-lab: no solver at ${file}; run tools/vroom-wasm/install.mjs`);
  const module = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    createVroom(): Promise<Solver>;
  };
  return module.createVroom();
}
