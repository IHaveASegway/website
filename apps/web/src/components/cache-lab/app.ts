import { eventLog } from '../../lib/lab/event-log';
import { heldByThePage, runOnLanding } from '../../lib/lab/landing-run';
import { speaker, startsOver } from '../../lib/lab/said';
import { address } from '../../lib/sim/link';
import { NODES, PAGES, seconds, type Load, type Placement } from '../../lib/cache/core';
import {
  flush,
  loseNode,
  nextTime,
  restoreNode,
  runUntil,
  setLoad,
  setPlacement,
  setToggle,
  write,
  type Sim,
  type Toggle,
} from '../../lib/cache/sim';
import {
  AGAIN,
  clockWords,
  linkTo,
  mapWords,
  menuWords,
  nodeWords,
  OPENING,
  openingRun,
  openLink,
  outcomeStrip,
  pagesOn,
  pageState,
  propertyLines,
  readersWords,
  REPLAY_FROM,
  REPLAY_WORDS,
  STORY,
  stripWords,
  summary,
  waiting,
  whereWords,
} from '../../lib/cache/view';
import { crowded, pageLamps, stripEnds, stripPaths } from './picture';
import { curled } from '../../lib/typeset.mjs';

// The Cache Lab in the browser: the simulation, run in virtual time and drawn on every frame while
// it runs. It takes over the same opening the build drew. A visitor who didn't ask for less motion
// lands on it running (ADR 0030); otherwise it moves only when they press Run, which Pause stops
// (SC 2.2.2), and a hidden tab pauses it too.
//
// The controls mean what they mean in every lab (docs/lab.md, "The controls"). The opening's picture
// tells a stampede that has already happened, so Run on a run still standing at that moment, with
// nothing done since but a choice of settings, plays it again from half a second before the menu
// expires. Start over goes back there too and writes the link to the run it plays, and so does a
// press of a switch against the stampede (view.ts, STORY): the visitor watches the same expiry come
// out another way. With reduced motion, Run advances half a second of the chosen speed twice a
// second, so the picture changes in still steps. Every action lands between two moments of the run,
// never inside one: the frames and Next event move the clock with runUntil, which stops only there
// (lib/cache/sim.ts), so an action is the one a replay of the same run would take. A link to a run
// (lib/sim/link.ts) opens it, paused at the opening's moment, on load or when followed on the page.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 4_000;
const STILL_EVERY = 500; // real ms between steps under reduced motion
const TOGGLES: readonly Toggle[] = ['coalesce', 'stale', 'early', 'jitter', 'invalidate'];
/** What a recorded action is when it only chose a setting: the run stands where it did. */
const CHOOSES = new Set(['toggle', 'load', 'placement']);

/** A broken invariant, the one thing that stops a run: a bug in the simulation, said where it
 *  happened. The properties' lamps say everything else, so the status line's sentence does not
 *  ship. */
const broken = (sim: Sim): string =>
  sim.violation ? `Broken at ${seconds(sim.violation.at)}: ${sim.violation.detail}.` : '';

export function start(root: HTMLElement, queued: readonly Element[]): () => void {
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const run = $<HTMLButtonElement>('[data-cl-run]');
  const lines = $('[data-cl-lines]') as HTMLElement;
  const strip = $('[data-cl-strip]');
  const text = (element: Element | null | undefined, value: string) => {
    const words = curled(value);
    if (element && element.textContent !== words) element.textContent = words;
  };
  const attribute = (element: Element | null | undefined, name: string, value: string) => {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  const speed = () =>
    Number($<HTMLInputElement>('input[name="cl-speed"]:checked')?.value ?? 0.5) || 0.5;

  // A link to a run opens it; anything else opens the opening the build drew.
  const linked = openLink(location.hash);
  let sim: Sim = linked ?? openingRun();
  let playing = false;
  let last = 0;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  // The build wrote the opening's last lines; a link's run writes its own.
  const log = eventLog(lines, 'lab-log-at', seconds, linked ? undefined : sim.lines.at(-1));
  if (linked) log.clear();
  const say = speaker(root);
  // What the page shows: which node held each page when its lamps were last laid out, and each
  // page's lamp and state since.
  let shownOwners: readonly number[] = [];
  let lamps: (Element | undefined)[] = [];
  const shownState: string[] = [];

  /** The nodes' lamps: laid out again when a page changes node, then each one's state. */
  function drawPages(): void {
    if (shownOwners !== sim.owners) {
      shownOwners = sim.owners;
      lamps = [];
      for (let id = 0; id < NODES; id++) {
        const box = $(`[data-cl-pages="${id}"]`);
        if (!box) continue;
        box.innerHTML = pageLamps(sim, id);
        box.toggleAttribute('data-crowded', crowded(sim, id));
        const found = box.querySelectorAll('.cl-lamp');
        pagesOn(sim, id).forEach((key, i) => {
          lamps[key] = found[i];
          shownState[key] = found[i]?.getAttribute('data-state') ?? '';
        });
      }
    }
    for (let key = 0; key < PAGES; key++) {
      const state = pageState(sim, key);
      if (shownState[key] === state) continue;
      lamps[key]?.setAttribute('data-state', state);
      shownState[key] = state;
    }
    text($('[data-cl-menu]'), menuWords(sim));
    attribute($('[data-cl-menu-lamp]'), 'data-state', pageState(sim, 0));
  }

  /** Everything the page shows of the run, changed only where it changed. */
  function draw(): void {
    drawPages();
    for (let id = 0; id < NODES; id++) {
      const up = Boolean(sim.nodes[id]?.up);
      for (const part of ['node', 'fan', 'link'])
        attribute($(`[data-cl-${part}="${id}"]`), 'data-up', String(up));
      text($(`[data-cl-node="${id}"] [data-cl-node-words]`), nodeWords(sim, id));
      const button = $(`[data-cl-lose="${id}"]`);
      const words = `${up ? 'Lose' : 'Restart'} node ${id + 1}`;
      text(button, words);
      attribute(button, 'aria-label', `${words}, now ${up ? `up, ${nodeWords(sim, id)}` : 'down'}`);
    }
    root.querySelectorAll('[data-cl-conns] .cl-conn').forEach((lamp, i) => {
      attribute(lamp, 'data-state', i < sim.running ? 'busy' : 'idle');
    });
    text($('[data-cl-waiting]'), waiting(sim).toLocaleString('en-US'));
    text($('[data-cl-readers]'), readersWords(sim));
    attribute($('[data-cl-map]'), 'aria-label', mapWords(sim));

    const buckets = outcomeStrip(sim);
    for (const [lane, d] of Object.entries(stripPaths(buckets)))
      attribute($(`[data-cl-lane="${lane}"]`), 'd', d);
    const [from, to] = stripEnds(buckets, sim.now);
    text($('[data-cl-from]'), from);
    text($('[data-cl-to]'), to);
    attribute(strip, 'aria-label', stripWords(sim));

    for (const p of propertyLines(sim)) {
      const row = $(`[data-cl-prop="${p.id}"]`);
      attribute(row, 'data-held', String(p.held));
      text(row?.querySelector('[data-cl-prop-words]'), p.words);
    }
    text($('[data-cl-summary]'), summary(sim));
    text(
      $('[data-cl-clock]'),
      sim.violation ? `${clockWords(sim)}. ${broken(sim)}` : clockWords(sim),
    );

    for (const toggle of TOGGLES)
      attribute($(`[data-cl-toggle="${toggle}"]`), 'aria-pressed', String(sim[toggle]));
    for (const [name, value] of [
      ['cl-load', sim.load],
      ['cl-placement', sim.placement],
    ] as const) {
      const choice = $<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
      if (choice && !choice.checked) choice.checked = true;
    }
    log.draw(sim.lines);
  }

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    text(run, 'Run');
    // Run's lamp, never aria-pressed: its words change with its state, so it is no toggle.
    attribute(run, 'data-lamp', 'off');
    draw();
  }

  function tick(now: number): void {
    if (!playing) return;
    const elapsed = Math.min(FRAME_CAP, now - last);
    last = now;
    runUntil(sim, sim.now + elapsed * speed(), EVENTS_PER_FRAME);
    draw();
    if (sim.violation) {
      say(broken(sim));
      pause();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function play(): void {
    if (sim.violation) return;
    playing = true;
    text(run, 'Pause');
    attribute(run, 'data-lamp', 'on');
    if (still.matches) {
      timer = setInterval(() => {
        runUntil(sim, sim.now + STILL_EVERY * speed(), EVENTS_PER_FRAME);
        draw();
        if (sim.violation) {
          say(broken(sim));
          pause();
        }
      }, STILL_EVERY);
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** Shows another run from its start, its own event log and all. */
  function show(next: Sim): void {
    sim = next;
    log.clear();
    draw();
  }

  /** The run again from REPLAY_FROM, the one its link names: the seed and the settings stay. */
  function begin(): void {
    show(openLink(linkTo(sim), REPLAY_FROM) as Sim);
  }

  /** Whether the run stands where the picture told it, with nothing done since but a choice of
   *  settings: then Run plays what the picture told, under those settings, as it happens. */
  const untouched = () =>
    sim.now === OPENING.until && sim.actions.every((action) => CHOOSES.has(action.kind));

  /** Back to REPLAY_FROM under the settings as they stand, playing on if it was playing, with the
   *  address naming the run, so a reload or the link shared opens it. Says nothing: it says what it
   *  did, in the words of the press that called it. */
  function replay(): boolean {
    const wasPlaying = playing;
    pause();
    begin();
    writeLink(linkTo(sim));
    if (wasPlaying) play();
    return wasPlaying;
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    const { value } = control as HTMLInputElement; // a button's is empty
    if (control.matches('[data-cl-run]')) {
      if (playing) pause();
      else if (untouched()) {
        begin();
        play();
        say(AGAIN, control);
      } else {
        play();
        say('', control);
      }
      return;
    } else if (control.matches('[data-cl-step]')) {
      if (playing) pause();
      // Every event at the next moment, never one alone: an action after it then lands where a
      // replay puts it.
      runUntil(sim, nextTime(sim));
    } else if (control.matches('[data-cl-reset]')) {
      say(startsOver('run', 'these settings', REPLAY_WORDS, replay()), control);
      return;
    } else if (control.matches('[data-cl-toggle]')) {
      const toggle = control.getAttribute('data-cl-toggle') as Toggle;
      setToggle(sim, toggle, !sim[toggle]);
      if (STORY.includes(toggle)) {
        const line = sim.lines.at(-1)?.text ?? '';
        const started = startsOver('run', 'it', REPLAY_WORDS, replay());
        say(`${line}. ${started}`, control, `${line.split(':')[0]}. ${started}`);
        return;
      }
    } else if (control.matches('[data-cl-write]')) {
      write(sim, 0);
    } else if (control.matches('[data-cl-flush]')) {
      flush(sim);
    } else if (control.matches('[data-cl-lose]')) {
      const id = Number(control.getAttribute('data-cl-lose'));
      if (sim.nodes[id]?.up) loseNode(sim, id);
      else restoreNode(sim, id);
    } else if (control.matches('input[name="cl-load"]')) {
      setLoad(sim, value as Load);
    } else if (control.matches('input[name="cl-placement"]')) {
      setPlacement(sim, value as Placement);
    } else return;
    const latest = sim.lines.at(-1);
    if (latest && latest !== before) say(latest.text, control);
    // A moment the log does not tell, as most are: where the run stands now, so the press is heard.
    else if (control.matches('[data-cl-step]')) say(whereWords(sim), control);
    draw();
  }

  root.addEventListener('click', (event) => {
    const control = (event.target as Element).closest('button');
    if (control) press(control);
  });
  root.addEventListener('change', (event) => {
    if (event.target instanceof Element) press(event.target);
  });
  const moving = { play, pause, playing: () => playing };
  heldByThePage(root, moving, still);
  // A link to another run followed on this page opens that run, paused, as loading it would.
  const writeLink = address(() => {
    const next = openLink(location.hash);
    if (next) {
      pause();
      show(next);
      say(summary(sim));
    }
    return next;
  });

  draw();
  for (const control of queued) press(control);
  // The run a visitor lands on plays the stampede the picture told, as Run does, and again.
  return () => {
    runOnLanding(root, {
      ...moving,
      play: () => {
        if (untouched()) begin();
        play();
      },
      finished: () => Boolean(sim.violation) || !Number.isFinite(nextTime(sim)),
      again: () => {
        begin();
        play();
      },
    });
  };
}
