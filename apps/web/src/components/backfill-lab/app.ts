import { eventLog } from '../../lib/lab/event-log';
import { runOnLanding } from '../../lib/lab/landing-run';
import { speaker, startsOver, type Say } from '../../lib/lab/said';
import { TASKS, weekday, when, type Mode, type PartitionKey } from '../../lib/backfill/core';
import {
  clear,
  failNextLoad,
  finished,
  nextTime,
  runUntil,
  setMaxActiveRuns,
  setMode,
  setPartition,
  start as switchOn,
  type Line,
  type Sim,
} from '../../lib/backfill/sim';
import {
  beforeSwitch,
  boardView,
  eventsText,
  fromTheSwitch,
  holdFile,
  LATE_BY,
  lineTime,
  linkTo,
  moment,
  OPENING,
  openingRun,
  openLink,
  propertyViews,
  REPLAY_WORDS,
  statusText,
  STORY_WORDS,
  stripLabel,
  stripMarkup,
  summary,
  switchWords,
} from '../../lib/backfill/view';

// The Backfill Lab in the browser (ADR 0026, as ADR 0020 for the Raft Lab): the simulation, run in
// virtual minutes and redrawn on every frame while it runs. It takes over the same opening the build
// drew. A visitor who didn't ask for less motion lands on it running (ADR 0030); otherwise it moves
// only when they press Run, which Pause stops (SC 2.2.2). A hidden tab pauses it, and so does a week
// with nothing left to happen. Time moves in whole minutes, the core's unit: each frame owes the clock
// its share of the speed, and the clock is paid in whole minutes, through runUntil, never a bare step
// between actions, so every press lands where replay would put it. With reduced motion it moves in
// still steps, twice a second.
//
// The controls mean what they mean in every lab (docs/lab.md, "The controls"). The opening's week has
// already happened, so Run on a week that has finished, or one still standing at the opening's moment
// with nothing done since but a choice of settings, takes it back to its switch and plays it, under
// the settings chosen now and with the failures and late files set for it. Start over goes back
// there too, to the opening's own set-up (view.ts, fromTheSwitch), and writes the link to the week it
// shows, and so does a choice of how a load writes or which day it writes: the visitor watches
// Wednesday's failed load and its day counted twice come out another way, and never lands past them.
// With the job off, Run, or Next event, switches it on first, so the clock never moves with the job
// off and the week starts at 00:00, as the lab entry's does. A link to a week (lib/sim/link.ts) opens
// the opening's week under its settings where the build draws it, finished (view.ts, openingWeek),
// paused, on load or when followed on the page.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 2_000;
const STILL_EVERY = 500; // real ms between still steps

export function start(root: HTMLElement, queued: readonly Element[]): () => void {
  const $ = <T extends Element>(selector: string, from: ParentNode = root) =>
    from.querySelector<T>(selector);
  const radios = (name: string) => [
    ...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
  ];
  const chosen = (name: string) => radios(name).find((r) => r.checked)?.value;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const run = $<HTMLButtonElement>('[data-bf-run]');
  const on = $('[data-bf-on]');
  const strip = $('[data-bf-strip]');
  const lines = $<HTMLOListElement>('[data-bf-lines]');
  const stray = $<HTMLElement>('[data-bf-stray]');
  const rows = [...root.querySelectorAll('[data-bf-day]')];
  const set = (element: Element | null | undefined, value: string) => {
    if (element && element.textContent !== value) element.textContent = value;
  };
  const mark = (element: Element | null | undefined, name: string, value: string) => {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  };

  const linked = openLink(location.hash);
  let sim: Sim = linked ?? openingRun();
  let playing = false;
  let last = 0;
  let owed = 0; // virtual minutes the clock is owed, under one
  let frame = 0;
  let timer = 0;
  let speed = Number(chosen('bf-speed') ?? 6);
  let day = Number(chosen('bf-day') ?? 0);
  /** Whether the week stands where the picture told it: opened at the opening's moment, and neither
   *  played nor stepped since. */
  let told = true;
  let shownStrip = '';
  // The build wrote the opening's last lines; a link's week writes its own.
  const log = eventLog(lines, 'lab-log-at', lineTime, linked ? undefined : sim.lines.at(-1));
  if (linked) log.clear();
  const tell = speaker(root, $('[data-bf-said]'));
  /** While the week is the one a visitor landed on, nobody's choice yet, it says nothing. */
  let landing = false;
  const say: Say = (words, control, short) => {
    if (!landing) tell(words, control, short);
  };

  /** Everything the page shows of the run, changed only where it changed. */
  function draw(): void {
    const view = boardView(sim);
    view.days.forEach((d, i) => {
      const row = rows[i];
      if (!row) return;
      set($('[data-bf-run-word]', row), d.run);
      const cells = row.querySelectorAll('[data-bf-step]');
      d.steps.forEach((step, k) => {
        const cell = cells[k];
        mark(cell, 'data-lamp', step.lamp);
        set(cell?.querySelector('[data-bf-word]'), step.word);
        set(cell?.querySelector('[data-bf-retry]'), step.retry);
      });
      set($('[data-bf-report]', row), d.report);
      set($('[data-bf-diff]', row), d.difference);
      set($('[data-bf-source]', row), d.source);
    });
    if (stray) {
      stray.hidden = view.stray === null;
      set($('[data-bf-stray-short]', stray), view.stray?.short ?? '');
      set($('[data-bf-stray-long]', stray), view.stray?.long ?? '');
      set($('[data-bf-stray-rows]', stray), view.stray?.rows ?? '');
    }
    set($('[data-bf-week-report]'), view.week.report);
    set($('[data-bf-week-diff]'), view.week.difference);
    set($('[data-bf-week-source]'), view.week.source);
    set($('[data-bf-summary]'), summary(sim));
    for (const check of propertyViews(sim)) {
      const item = $(`[data-bf-check="${check.id}"]`);
      mark(item, 'data-lamp', check.held ? 'filled' : 'cross');
      set(item?.querySelector('[data-bf-check-word]'), check.word);
    }
    set($('[data-bf-clock]'), when(sim.now));
    set($('[data-bf-events]'), eventsText(sim));
    set($('[data-bf-seed]'), String(sim.seed));
    // The job's switch only switches on, so it is no toggle: once the job is on, it says so, and
    // since when, and it is unavailable until Start over or a late file sends the week back to
    // before the switch.
    set(on, switchWords(sim));
    if (sim.on) mark(on, 'aria-disabled', 'true');
    else on?.removeAttribute('aria-disabled');
    const markup = stripMarkup(sim);
    if (strip && markup !== shownStrip) {
      strip.innerHTML = markup;
      mark(strip, 'aria-label', stripLabel(sim));
      shownStrip = markup;
    }
    // The choices that are the run's settings show the run's: a page the browser restored with
    // other choices ticked says what the simulation does, not what the form remembered.
    for (const r of radios('bf-mode')) r.checked = r.value === sim.mode;
    for (const r of radios('bf-partition')) r.checked = r.value === sim.partition;
    for (const r of radios('bf-runs')) r.checked = Number(r.value) === sim.maxActiveRuns;
    log.draw(sim.lines);
  }

  /** Why the clock cannot move, or null while something is still due. */
  function stuck(): string | null {
    if (sim.violation) return statusText(sim);
    if (Number.isFinite(nextTime(sim))) return null;
    return finished(sim)
      ? 'Every run has finished, so the clock stops here. Run plays the week again from the switch, or clear a day to rerun it.'
      : 'Nothing more is due, so the clock stops here.';
  }

  /** Whether every run has finished and nothing is left to happen: Run and Next event then take
   *  the week back to its switch, under the settings chosen now (view.ts, beforeSwitch). */
  const over = () => !sim.violation && finished(sim) && !Number.isFinite(nextTime(sim));
  /** Whether the week stands where the picture told it, with nothing done since but a choice of the
   *  limit of runs: then Run plays what the picture told, under that limit, as it happens. */
  const untouched = () =>
    told && sim.actions.slice(OPENING.actions.length).every((a) => a.kind === 'max-active-runs');
  const AGAIN = 'The week plays again from the switch.';

  /** What happened after a line, in the log's words: its lines, up to the last four of them. */
  function since(line: Line | undefined): string {
    const added = sim.lines.slice(line ? sim.lines.indexOf(line) + 1 : 0).slice(-4);
    return added.map((each) => `${each.text}.`).join(' ');
  }

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    set(run, 'Run');
    // Run's lamp, never aria-pressed: its words change with its state, so it is no toggle.
    mark(run, 'data-lamp', 'off');
    draw();
  }

  /** Moves the clock on by whole minutes, event by event, so that once nothing is left to happen
   *  it stands at the last thing that did, and the run stops there. */
  function advance(minutes: number): void {
    const until = sim.now + minutes;
    for (let at = nextTime(sim); Number.isFinite(at) && sim.now < until; at = nextTime(sim)) {
      const [now, steps] = [sim.now, sim.steps];
      runUntil(sim, Math.min(at, until), EVENTS_PER_FRAME);
      if (sim.now === now && sim.steps === steps) break; // a violation froze the run
    }
    const why = stuck();
    if (why) {
      say(why);
      pause();
    } else draw();
  }

  function tick(now: number): void {
    if (!playing) return;
    owed += (Math.min(FRAME_CAP, now - last) * speed) / 1000;
    last = now;
    const minutes = Math.floor(owed);
    if (minutes > 0) {
      owed -= minutes;
      advance(minutes);
    }
    if (playing) frame = requestAnimationFrame(tick);
  }

  function play(): void {
    const why = stuck();
    if (why) {
      say(why);
      return;
    }
    playing = true;
    owed = 0;
    set(run, 'Pause');
    mark(run, 'data-lamp', 'on');
    if (still.matches) {
      // Half a second's worth of the chosen speed at a time: 1, 3 or 15 minutes.
      timer = window.setInterval(() => advance(Math.max(1, Math.round(speed / 2))), STILL_EVERY);
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** Plays the week, switching the job on first if it is off: with the job off nothing but a file
   *  landing could happen, and the week would start late, so the switch comes at the minute the
   *  week ends. `back` says the week went back to its switch to get here. */
  function go(before: Line | undefined, control?: Element, back = ''): void {
    told = false;
    if (!sim.on) {
      switchOn(sim);
      draw();
      say(`${back}${since(before)}`, control);
    } else say(back, control);
    play();
  }

  /** Names the day the day's buttons act on. */
  function pick(next: number): void {
    day = next;
    for (const name of root.querySelectorAll('[data-bf-picked]')) set(name, weekday(day));
  }

  /** A word more when a press can change nothing yet, so the visitor knows what would. */
  function hint(control: Element): string {
    const run = sim.runs[day];
    if (control.matches('[data-bf-fail]') && run?.tasks[TASKS.indexOf('load')]?.state === 'success')
      return ` ${weekday(day)} has loaded already, so this fails its load when the week plays again, or after a clear.`;
    return '';
  }

  /** A week that replaces the one shown: Start over's, or one a late file or a setting sent back. */
  function show(next: Sim): void {
    pause();
    sim = next;
    log.clear();
  }

  /** Back to the switch and on, if the week was playing: what a setting that decides the story and
   *  a late file do to a week whose file has landed. Says whether it plays on. */
  function sendBack(next: Sim, control: Element): boolean {
    const wasPlaying = playing;
    show(next);
    told = false;
    if (wasPlaying) go(sim.lines.at(-1), control);
    return wasPlaying;
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    const value = control instanceof HTMLInputElement ? control.value : '';
    const name = control instanceof HTMLInputElement ? control.name : '';
    let words = '';
    let short: string | undefined;
    if (control.matches('[data-bf-run]')) {
      if (playing) pause();
      else {
        const back = over() || untouched();
        if (back) show(beforeSwitch(sim));
        go(before, control, back ? `${AGAIN} ` : '');
      }
      return;
    } else if (name === 'bf-speed') {
      speed = Number(value);
      if (playing && still.matches) {
        pause();
        play();
      }
      return;
    } else if (name === 'bf-day') {
      pick(Number(value));
      return;
    } else if (control.matches('[data-bf-step]')) {
      const back = over();
      if (back) show(beforeSwitch(sim));
      told = false;
      const at = nextTime(sim);
      // With the job off, the switch is the week's next step, as Run takes it.
      if (!sim.on) {
        switchOn(sim);
        if (back) words = `${AGAIN} ${since(before)}`;
      } else if (Number.isFinite(at) && !sim.violation) runUntil(sim, at, EVENTS_PER_FRAME);
      else words = stuck() ?? '';
    } else if (control.matches('[data-bf-reset]')) {
      const wasPlaying = sendBack(fromTheSwitch(sim), control);
      // The address names the week, settings and all, so a reload or the link shared opens it.
      history.replaceState(null, '', linkTo(sim));
      draw();
      say(startsOver('week', 'these settings', REPLAY_WORDS, wasPlaying), control);
      return;
    } else if (control.matches('[data-bf-on]')) {
      // A switch that only switches on: once the job is on, it says so and does nothing.
      const on = sim.actions.find((a) => a.kind === 'start');
      if (on) words = `The job is on already: it was switched on at ${moment(on.at)}.`;
      else {
        told = false;
        switchOn(sim);
      }
    } else if (name === 'bf-mode' || name === 'bf-partition') {
      // A setting that decides the story: the week starts over under it, as the visitor just asked.
      if (name === 'bf-mode') setMode(sim, value as Mode);
      else setPartition(sim, value as PartitionKey);
      const line = sim.lines.at(-1)?.text ?? '';
      const wasPlaying = sendBack(beforeSwitch(sim), control);
      history.replaceState(null, '', linkTo(sim));
      const started = startsOver('week', 'it', REPLAY_WORDS, wasPlaying);
      draw();
      say(
        `${line}. ${started}`,
        control,
        `${STORY_WORDS[value as Mode | PartitionKey]}. ${started}`,
      );
      return;
    } else if (name === 'bf-runs') setMaxActiveRuns(sim, Number(value));
    else if (control.matches('[data-bf-fail]')) {
      failNextLoad(sim, day);
      short = `${weekday(day)}'s next load will fail part way.${hint(control)}`;
    } else if (control.matches('[data-bf-late]')) {
      const hours = LATE_BY / 60;
      const week = holdFile(sim, day);
      if (week !== sim) {
        const line = week.lines.at(-1)?.text ?? '';
        const wasPlaying = sendBack(week, control);
        words = `${weekday(day)}'s sensor has found its file already, so the week goes back to before the job is switched on. ${line}.${wasPlaying ? '' : ' Press Run to backfill the week.'}`;
        short = `${weekday(day)}'s file is ${hours} hours late, so the week goes back to before the job is switched on.${wasPlaying ? '' : ' Press Run to watch it.'}`;
      }
    } else if (control.matches('[data-bf-clear]')) {
      clear(sim, day);
      told = false;
      if (sim.lines.at(-1) === before)
        words = sim.runs[day]
          ? `${weekday(day)}'s run has not started, so there is nothing to clear.`
          : `${weekday(day)} has no run to clear while the job is off.`;
    } else return;
    draw();
    // What the press set off, in the log's words.
    const happened = since(before);
    say(words || (happened ? `${happened}${hint(control)}` : summary(sim)), control, short);
  }

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button');
    if (control) press(control);
  });
  root.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement) press(event.target);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) pause();
  });
  // A link to a week followed on this page opens that week, paused, as loading it would.
  addEventListener('hashchange', () => {
    const next = openLink(location.hash);
    if (!next) return;
    show(next);
    told = true;
    draw();
    say(summary(sim));
  });
  still.addEventListener('change', () => {
    if (playing) {
      pause();
      play();
    }
  });

  pick(day);
  draw();
  for (const control of queued) press(control);
  // The week a visitor lands on plays as Run plays it, and again from the switch.
  const replay = () => {
    if (run) press(run);
  };
  return () => {
    landing = true;
    runOnLanding(root, {
      play: replay,
      pause,
      playing: () => playing,
      finished: over,
      again: replay,
      taken: () => {
        landing = false;
      },
    });
  };
}
