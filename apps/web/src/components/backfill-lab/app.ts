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
  holdFile,
  lineTime,
  linkTo,
  moment,
  openingRun,
  openLink,
  propertyViews,
  startOver,
  statusText,
  stripLabel,
  stripMarkup,
  summary,
} from '../../lib/backfill/view';

// The Backfill Lab in the browser (ADR 0026, as ADR 0020 for the Raft Lab): the simulation, run in
// virtual minutes and redrawn on every frame while it runs. It opens paused, on the same opening
// the build drew, and moves only when the visitor presses Run, which Pause stops (SC 2.2.2); a
// hidden tab pauses it, and so does a week with nothing left to happen. Time moves in whole
// minutes, the core's unit: each frame owes the clock its share of the speed, and the clock is
// paid in whole minutes, through runUntil, never a bare step between actions, so every press lands
// where replay would put it. With reduced motion it moves in still steps, twice a second.
//
// Start over, like a link to a week (lib/sim/link.ts), shows the opening's week under the chosen
// settings, as the build draws it (view.ts, openingWeek), and writes the link to it; a link opens
// its week paused, on load or when followed on the page. The job is off only once a late file has
// sent the week back to before the switch (holdFile); then Run, or Next event, switches it on
// first, so the clock never moves with the job off and the week starts at 00:00, as the lab
// entry's does. A week whose runs have all finished, as the opening's has, goes back to the switch
// the same way when Run or Next event is pressed, so the story its picture tells can be watched,
// as the Cache Lab's Run plays its stampede again.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 2_000;
const STILL_EVERY = 500; // real ms between still steps
const LINES_SHOWN = 60;

export function start(root: HTMLElement, queued: readonly Element[]): void {
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
  const stray = $<HTMLTableRowElement>('[data-bf-stray]');
  const said = $('[data-bf-said]');
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
  let shownLine: Line | undefined;
  let shownStrip = '';

  const say = (words: string) => {
    if (said) said.textContent = words;
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
    // it is unavailable until a late file sends the week back to before the switch.
    set(on, sim.on ? 'The job is on' : 'Switch the job on');
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
    drawLines();
  }

  /** The event log: new lines appended, the oldest dropped past 60. */
  function drawLines(): void {
    if (!lines) return;
    const from = shownLine ? sim.lines.indexOf(shownLine) + 1 : 0;
    if (shownLine && from === 0) lines.replaceChildren();
    const first = from === 0 ? Math.max(0, sim.lines.length - LINES_SHOWN) : from;
    for (const line of sim.lines.slice(first)) {
      const item = document.createElement('li');
      const at = document.createElement('span');
      at.className = 'bf-at';
      at.textContent = lineTime(line.at);
      item.append(at, ` ${line.text}`);
      lines.append(item);
    }
    while (lines.children.length > LINES_SHOWN) lines.firstElementChild?.remove();
    const box = lines.parentElement;
    if (box && sim.lines.length > first) box.scrollTop = box.scrollHeight;
    shownLine = sim.lines.at(-1);
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

  /** Names the day the day's buttons act on. */
  function pick(next: number): void {
    day = next;
    for (const name of root.querySelectorAll('[data-bf-picked]')) set(name, weekday(day));
  }

  /** A word more when a press can change nothing yet, so the visitor knows what would. */
  function hint(control: Element): string {
    const run = sim.runs[day];
    if (control.matches('[data-bf-fail]') && run?.tasks[TASKS.indexOf('load')]?.state === 'success')
      return ` ${weekday(day)} has loaded already, so this fails only a load after a clear.`;
    return '';
  }

  /** A week that replaces the one shown: Start over's, or one a late file sent back. */
  function show(next: Sim): void {
    pause();
    sim = next;
    shownLine = undefined;
    lines?.replaceChildren();
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    const value = control instanceof HTMLInputElement ? control.value : '';
    const name = control instanceof HTMLInputElement ? control.name : '';
    let words = '';
    if (control.matches('[data-bf-run]')) {
      if (playing) pause();
      else {
        const again = over();
        if (again) show(beforeSwitch(sim));
        // With the job off nothing but a file landing could happen, and the week would start
        // late, so Run switches it on first, at the minute the week ends.
        if (!sim.on) {
          switchOn(sim);
          draw();
          say(again ? `${AGAIN} ${since(before)}` : since(before));
        }
        play();
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
      const again = over();
      if (again) show(beforeSwitch(sim));
      const at = nextTime(sim);
      // With the job off, the switch is the week's next step, as Run takes it.
      if (!sim.on) {
        switchOn(sim);
        if (again) words = `${AGAIN} ${since(before)}`;
      } else if (Number.isFinite(at) && !sim.violation) runUntil(sim, at, EVENTS_PER_FRAME);
      else words = stuck() ?? '';
    } else if (control.matches('[data-bf-reset]')) {
      show(startOver(sim));
      // The address names the week, settings and all, so a reload or the link shared opens it.
      history.replaceState(null, '', linkTo(sim));
      words = `The week starts over under these settings, and stands at ${moment(sim.now)}. ${summary(sim)}`;
    } else if (control.matches('[data-bf-on]')) {
      // A switch that only switches on: once the job is on, it says so and does nothing.
      const on = sim.actions.find((a) => a.kind === 'start');
      if (on) words = `The job is on already: it was switched on at ${moment(on.at)}.`;
      else switchOn(sim);
    } else if (name === 'bf-mode') setMode(sim, value as Mode);
    else if (name === 'bf-partition') setPartition(sim, value as PartitionKey);
    else if (name === 'bf-runs') setMaxActiveRuns(sim, Number(value));
    else if (control.matches('[data-bf-fail]')) failNextLoad(sim, day);
    else if (control.matches('[data-bf-late]')) {
      const week = holdFile(sim, day);
      if (week !== sim) {
        show(week);
        words = `${weekday(day)}'s sensor has found its file already, so the week goes back to before the job is switched on. ${sim.lines.at(-1)?.text ?? ''}. Press Run to backfill the week.`;
      }
    } else if (control.matches('[data-bf-clear]')) {
      clear(sim, day);
      if (sim.lines.at(-1) === before)
        words = sim.runs[day]
          ? `${weekday(day)}'s run has not started, so there is nothing to clear.`
          : `${weekday(day)} has no run to clear while the job is off.`;
    } else return;
    draw();
    // What the press set off, in the log's words.
    const told = since(before);
    say(words || (told ? `${told}${hint(control)}` : summary(sim)));
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
  if (linked) lines?.replaceChildren();
  else shownLine = sim.lines.at(-1);
  draw();
  // The newest line in view, as each line the run adds keeps it: the build wrote the log's oldest
  // first, and a page that kept them has added none.
  const box = lines?.parentElement;
  if (box) box.scrollTop = box.scrollHeight;
  for (const control of queued) press(control);
}
