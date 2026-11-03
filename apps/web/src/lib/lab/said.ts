// What a press did, or why it did nothing, said on the screen and to a screen reader (the Route Lab's
// way, its rl-status and rl-say): the whole of it in one hidden live region, and a short form on the
// screen, in a line beside the controls the press came from, with its room kept so nothing moves. A
// phone's desk is too long for one line to serve it: the settings stand over a thousand pixels under
// Run, so each part of the controls has its own (components/lab/Said.astro). Until a press, and when
// a press has nothing to say, a line says what its controls do. Until 2026-11-02 the words reached
// only a screen reader, and sighted visitors got buttons that looked dead.

import { curled } from '../typeset.mjs';

/** The most characters the line on the screen says, which its room holds at the narrowest phone
 *  (lab-controls.css, .lab-said; e2e/steady.spec.ts). */
export const SAID_ROOM = 140;

/** As many whole sentences as the line has room for, and at least one: the event log has the rest.
 *  A decimal's point is no sentence's end, since a sentence ends at a point before a space. The log's
 *  own lines end in no point, so a line here gets one. */
export function shortly(words: string): string {
  if (!words) return '';
  const [first = '', ...rest] = words.split(/(?<=\.) /);
  let short = first;
  for (const next of rest) {
    if (short.length + 1 + next.length > SAID_ROOM) break;
    short += ` ${next}`;
  }
  return short.endsWith('.') ? short : `${short}.`;
}

/** What a run that went back says, in every lab: "The run starts over under these settings, at
 *  1.500 s, before worker 2's crash. Press Run to watch it." A run still playing plays on from there,
 *  so it asks for no press. `under` is the settings or the one just chosen. */
export const startsOver = (what: string, under: string, where: string, playing: boolean): string =>
  `The ${what} starts over under ${under}, ${where}.${playing ? '' : ' Press Run to watch it.'}`;

/** Says what a press did. `short` is what the screen shows, by default the whole words cut to its
 *  room; `control` is the press's, whose part of the controls says it, by default the first part. */
export type Say = (words: string, control?: Element | null, short?: string) => void;

export function speaker(root: Element): Say {
  const lines = [...root.querySelectorAll<HTMLElement>('[data-said]')];
  const live = root.querySelector('[role="status"]') as Element;
  return (words, control, short = shortly(words)) => {
    live.textContent = curled(words);
    const here = control?.closest('[data-part]')?.querySelector('[data-said]') ?? lines[0];
    for (const line of lines) {
      const spoke = line === here && short !== '';
      line.textContent = curled(spoke ? short : (line.dataset['said'] as string));
      line.toggleAttribute('data-spoke', spoke);
    }
  };
}
