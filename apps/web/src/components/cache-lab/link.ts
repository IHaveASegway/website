import { LOADS } from '../../lib/cache/core';
import { createSim, type Config, type Sim } from '../../lib/cache/sim';
import { OPENING } from '../../lib/cache/view';

// A link to a run: its seed, then each setting Start over keeps that differs from the opening's,
// so the link opens the run the page showed, switches and all: #seed-7&coalesce=on&stale=on. A
// link names a run's start, as Start over plays it, not the presses made during it.

/** The settings Start over keeps, in the order a link names them: the load, the placement, then
 *  the switches. */
const SETTINGS = [
  'load',
  'placement',
  'coalesce',
  'stale',
  'early',
  'jitter',
  'invalidate',
] as const;
const SWITCHES: readonly string[] = SETTINGS.slice(2);

export type Settings = Partial<Pick<Config, (typeof SETTINGS)[number]>>;

/** A run's settings now, as Start over keeps them. */
export const settingsOf = ({
  load,
  placement,
  coalesce,
  stale,
  early,
  jitter,
  invalidate,
}: Sim): Settings => ({ load, placement, coalesce, stale, early, jitter, invalidate });

/** The run a link names, or null when it names none. A setting the lab does not have, or a value
 *  the setting cannot take, is left out, and the run keeps the opening's. */
export function fromLink(hash: string): { seed: number; settings: Settings } | null {
  const match = /^#seed-(\d{1,6})((?:&[\w-]+=[\w-]+)*)$/.exec(hash);
  if (!match) return null;
  const settings: Record<string, string | boolean> = {};
  for (const [name, value] of new URLSearchParams(match[2])) {
    const switched = SWITCHES.includes(name);
    const known =
      name === 'load'
        ? Object.hasOwn(LOADS, value)
        : name === 'placement'
          ? value === 'circle' || value === 'modulo'
          : switched && (value === 'on' || value === 'off');
    if (known) settings[name] = switched ? value === 'on' : value;
  }
  return { seed: Number(match[1]), settings: settings as Settings };
}

/** The link to a run's start: its seed, and the settings that differ from the opening's. */
export function toLink(sim: Sim): string {
  const opening = createSim(OPENING.config);
  const named = new URLSearchParams();
  for (const name of SETTINGS) {
    const value = sim[name];
    if (value !== opening[name])
      named.set(name, value === true ? 'on' : value === false ? 'off' : value);
  }
  const rest = named.toString();
  return `#seed-${sim.seed}${rest === '' ? '' : `&${rest}`}`;
}
