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
  type Line,
  type Sim,
  type Toggle,
} from '../../lib/cache/sim';
import {
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
  stripWords,
  summary,
  waiting,
  whereWords,
} from '../../lib/cache/view';
import { pageLamps, stripEnds, stripPaths } from './picture';

// The Cache Lab in the browser: the simulation, run in virtual time and drawn on every frame while
// it runs. It opens paused, on the same opening the build drew, and moves only when the visitor
// presses Run, which Pause stops (SC 2.2.2); a hidden tab pauses it too. The opening's picture
// tells a stampede that has already happened, so Run on a run still standing untouched at that
// moment plays it again from half a second before the menu expires, as Start over does: the
// visitor watches it happen. With reduced motion, Run advances half a second of the chosen speed
// twice a second, so the picture changes in still steps. Every action lands between
// two moments of the run, never inside one: the frames and Next event move the clock with
// runUntil, which stops only there (lib/cache/sim.ts), so an action is the one a replay of the
// same run would take. A link to a run (lib/sim/link.ts) opens it, paused at the opening's moment,
// on load or when followed on the page; Start over writes the link to the run it plays.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 4_000;
const STILL_EVERY = 500; // real ms between steps under reduced motion
const TOGGLES: readonly Toggle[] = ['coalesce', 'stale', 'early', 'jitter', 'invalidate'];

/** A broken invariant, the one thing that stops a run: a bug in the simulation, said where it
 *  happened. The properties' lamps say everything else, so the status line's sentence does not
 *  ship. */
const broken = (sim: Sim): string =>
  sim.violation ? `Broken at ${seconds(sim.violation.at)}: ${sim.violation.detail}.` : '';

export function start(root: HTMLElement, queued: readonly Element[]): void {
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const run = $<HTMLButtonElement>('[data-cl-run]');
  const lines = $<HTMLOListElement>('[data-cl-lines]');
  const strip = $('[data-cl-strip]');
  const said = $('[data-cl-said]');
  const text = (element: Element | null | undefined, value: string) => {
    if (element && element.textContent !== value) element.textContent = value;
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
  let timer = 0;
  // What the page shows: the last line of the event log, which node held each page when its lamps
  // were last laid out, and each page's lamp and state since.
  let shownLines: Line | undefined = linked ? undefined : sim.lines.at(-1);
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
      const words = `${up ? 'Lose' : 'Restore'} node ${id + 1}`;
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
    drawLines();
  }

  /** The event log: new lines appended, the oldest dropped past 60. */
  function drawLines(): void {
    if (!lines) return;
    const from = shownLines ? sim.lines.indexOf(shownLines) + 1 : 0;
    // The newest line stays in view while the reader is at the log's end, as an emptied log is. A
    // reader who has scrolled back to read is left there, not pulled down again by the next frame:
    // on a phone a finger on the log would otherwise fight every draw.
    const box = lines.parentElement;
    const following = box && box.scrollHeight - box.scrollTop - box.clientHeight < 2;
    if (shownLines && from === 0) lines.replaceChildren();
    const first = from === 0 ? Math.max(0, sim.lines.length - 60) : from;
    for (const line of sim.lines.slice(first)) {
      const item = document.createElement('li');
      const at = document.createElement('span');
      at.className = 'cl-at';
      at.textContent = seconds(line.at);
      item.append(at, ` ${line.text}`);
      lines.append(item);
    }
    while (lines.children.length > 60) lines.firstElementChild?.remove();
    if (box && following && sim.lines.length > first) box.scrollTop = box.scrollHeight;
    shownLines = sim.lines.at(-1);
  }

  const say = (words: string) => {
    if (said) said.textContent = words;
  };

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
      timer = window.setInterval(() => {
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
    shownLines = undefined;
    lines?.replaceChildren();
    draw();
  }

  /** The run again from REPLAY_FROM, the one its link names (Start over keeps the seed and the
   *  settings), drawn, and said where it stands: the clock, and the menu about to expire. */
  function begin(): void {
    show(openLink(linkTo(sim), REPLAY_FROM) as Sim);
    say(`${clockWords(sim)}. ${menuWords(sim)}.`);
  }

  function press(control: Element): void {
    const value = control instanceof HTMLInputElement ? control.value : '';
    if (control.matches('[data-cl-run]')) {
      if (playing) pause();
      else {
        // Still the moment the picture tells, untouched: play the stampede it told, as it happens.
        if (sim.now === OPENING.until && sim.actions.length === 0) begin();
        play();
      }
      return;
    } else if (control.matches('[data-cl-step]')) {
      // Every event at the next moment, never one alone: an action after it then lands where a
      // replay puts it.
      runUntil(sim, nextTime(sim));
    } else if (control.matches('[data-cl-reset]')) {
      const wasPlaying = playing;
      pause();
      begin();
      // The address names this run, switches and all, so a reload or the link shared opens it.
      history.replaceState(null, '', linkTo(sim));
      if (wasPlaying) play();
      return;
    } else if (control.matches('[data-cl-toggle]')) {
      const toggle = control.getAttribute('data-cl-toggle') as Toggle;
      setToggle(sim, toggle, !sim[toggle]);
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
    if (latest && latest !== shownLines) say(latest.text);
    // A moment the log does not tell, as most are: where the run stands now, so the press is heard.
    else if (control.matches('[data-cl-step]')) say(whereWords(sim));
    draw();
  }

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button');
    if (control) press(control);
  });
  root.addEventListener('change', (event) => {
    if (event.target instanceof Element) press(event.target);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) pause();
  });
  // A link to a run followed on this page opens that run, paused, as loading it would.
  addEventListener('hashchange', () => {
    const next = openLink(location.hash);
    if (!next) return;
    pause();
    show(next);
    say(summary(sim));
  });
  still.addEventListener('change', () => {
    if (playing) {
      pause();
      play();
    }
  });

  if (linked) lines?.replaceChildren();
  draw();
  // The newest line in view, as each line the run adds keeps it: the build wrote the log's oldest
  // first, and a page that kept them has added none.
  const box = lines?.parentElement;
  if (box) box.scrollTop = box.scrollHeight;
  for (const control of queued) press(control);
}
