// A link to a run, the same in every lab that simulates a system from a seed (the Raft, Queue,
// Cache and Backfill Labs): the seed, then each setting whose value is not the opening's, as
// #seed-7&coalesce=on&stale=on. Start over writes it; a page loaded with it, or a link followed on
// a page already loaded, opens that run paused at the lab's opening moment. A link names how a run
// starts, never the presses made during it: those go with the run.
//
// Each lab declares its settings: the values each one can take, and the opening's. Reading is
// tolerant (a tolerant reader, in Daigneau's "Service Design Patterns", 2011): a name the lab does
// not have, or a value its setting cannot take, is dropped, and the setting keeps the opening's,
// so a link from an older page, or one edited by hand, still opens its seed. A link that names no
// setting opens the run the build drew for its seed.

/** A setting's value: a word, a whole number, or a switch. */
export type Value = string | number | boolean;

/** A setting a link may name: every value it can take, and the one the lab opens with. */
export interface Setting {
  readonly values: readonly Value[];
  readonly opening: Value;
}

/** A lab's settings, in the order its links name them. */
export type Settings = Readonly<Record<string, Setting>>;

/** A value for each of a lab's settings. */
export type Values<S extends Settings> = { -readonly [K in keyof S]: S[K]['values'][number] };

/** A value as a link writes it, and as the page's choices name it: a switch as on or off. */
export const word = (value: Value): string =>
  value === true ? 'on' : value === false ? 'off' : `${value}`;

/** The value of a setting a word names, or undefined when the setting cannot take it. */
export const valueOf = <S extends Setting>(
  setting: S,
  text: string | undefined,
): S['values'][number] | undefined => setting.values.find((value) => word(value) === text);

/**
 * The run a link names: its seed, and a value for each setting, the link's where it names one the
 * setting can take, the opening's otherwise. Order does not matter; a setting named twice takes
 * its last naming. Null when the hash links to no run, as #main does.
 */
export function readLink<S extends Settings>(
  hash: string,
  settings: S,
): { readonly seed: number; readonly values: Values<S> } | null {
  const [, seed, rest] = /^#seed-(\d{1,6})(?:&(.*))?$/.exec(hash) ?? [];
  if (!seed) return null;
  const named = Object.fromEntries(new URLSearchParams(rest));
  const values: Record<string, Value> = {};
  for (const [name, setting] of Object.entries(settings))
    values[name] = valueOf(setting, named[name]) ?? setting.opening;
  return { seed: Number(seed), values: values as Values<S> };
}

/** The link to a run: its seed, then each setting whose value is not the opening's, in the order
 *  the lab declares them. */
export function writeLink<S extends Settings>(
  seed: number,
  values: { readonly [K in keyof S]: Value },
  settings: S,
): string {
  let link = `#seed-${seed}`;
  for (const [name, setting] of Object.entries(settings))
    if (values[name] !== setting.opening) link += `&${name}=${word(values[name] as Value)}`;
  return link;
}
