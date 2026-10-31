import { TASKS, weekday, when, type Mode, type PartitionKey } from '../../lib/backfill/core';
import {
  clear,
  failNextLoad,
  finished,
  lateFile,
  nextTime,
  replay,
  runUntil,
  setMaxActiveRuns,
  setMode,
  setPartition,
  start as switchOn,
  type Line,
  type Sim,
} from '../../lib/backfill/sim';
import {
  boardView,
  eventsText,
  LATE_BY,
  lineTime,
  OPENING,
  propertyViews,
  statusText,
  stripLabel,
  stripMarkup,
  summary,
  weekOff,
} from '../../lib/backfill/view';

// The Backfill Lab in the browser (ADR 0026, as ADR 0020 for the Raft Lab): the simulation, run in
// virtual minutes and redrawn on every frame while it runs. It opens paused, on the same opening
// the build drew, and moves only when the visitor presses Run, which Pause stops (SC 2.2.2); a
// hidden tab pauses it, and so does a week with nothing left to happen. Time moves in whole
// minutes, the core's unit: each frame owes the clock its share of the speed, and the clock is
// paid in whole minutes, through runUntil, never a bare step between actions, so every press lands
// where replay would put it. With reduced motion it moves in still steps, twice a second.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 2_000;
const STILL_EVERY = 500; // real ms between still steps
const LINES_SHOWN = 60;

const seedFromHash = (): number | null => {
  const match = /^#seed-(\d{1,6})$/.exec(location.hash);
  return match ? Number(match[1]) : null;
};

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

  const hashed = seedFromHash();
  let sim: Sim = replay(
    { ...OPENING.config, seed: hashed ?? OPENING.seed },
    OPENING.actions,
    OPENING.until,
  );
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
    });
    if (stray) {
      stray.hidden = view.stray === null;
      set($('[data-bf-stray-short]', stray), view.stray?.short ?? '');
      set($('[data-bf-stray-long]', stray), view.stray?.long ?? '');
      set($('[data-bf-stray-rows]', stray), view.stray?.rows ?? '');
    }
    set($('[data-bf-week-report]'), view.week.report);
    set($('[data-bf-week-diff]'), view.week.difference);
    set($('[data-bf-summary]'), summary(sim));
    for (const check of propertyViews(sim)) {
      const item = $(`[data-bf-check="${check.id}"]`);
      mark(item, 'data-lamp', check.held ? 'filled' : 'cross');
      set(item?.querySelector('[data-bf-check-word]'), check.word);
    }
    set($('[data-bf-clock]'), when(sim.now));
    set($('[data-bf-events]'), eventsText(sim));
    set($('[data-bf-seed]'), String(sim.seed));
    mark(on, 'aria-pressed', String(sim.on));
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
      ? 'Every run has finished, so the clock stops here. Clear a day to rerun it, or start over.'
      : 'Nothing more happens until the job is switched on, so the clock stops here.';
  }

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    set(run, 'Run');
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
    const name = weekday(day);
    if (control.matches('[data-bf-late]') && run?.tasks[0]?.state === 'success')
      return ` ${name}'s sensor has found its file already, so nothing waits for it: start over to try it from the top.`;
    if (control.matches('[data-bf-fail]') && run?.tasks[TASKS.indexOf('load')]?.state === 'success')
      return ` ${name} has loaded already, so this fails only a load after a clear.`;
    return '';
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    const value = control instanceof HTMLInputElement ? control.value : '';
    const name = control instanceof HTMLInputElement ? control.name : '';
    let words = '';
    if (control.matches('[data-bf-run]')) {
      if (playing) pause();
      else play();
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
      const at = nextTime(sim);
      if (Number.isFinite(at) && !sim.violation) runUntil(sim, at, EVENTS_PER_FRAME);
      else words = stuck() ?? '';
    } else if (control.matches('[data-bf-reset]')) {
      pause();
      sim = weekOff({
        seed: sim.seed,
        mode: sim.mode,
        partition: sim.partition,
        maxActiveRuns: sim.maxActiveRuns,
      });
      shownLine = undefined;
      lines?.replaceChildren();
      words = `The week starts over at ${when(sim.now)}, with the job off. ${sim.lines.at(-1)?.text ?? ''}.`;
    } else if (control.matches('[data-bf-on]')) {
      if (sim.on) words = 'The job is on already. Start over to switch it off.';
      else switchOn(sim);
    } else if (name === 'bf-mode') setMode(sim, value as Mode);
    else if (name === 'bf-partition') setPartition(sim, value as PartitionKey);
    else if (name === 'bf-runs') setMaxActiveRuns(sim, Number(value));
    else if (control.matches('[data-bf-fail]')) failNextLoad(sim, day);
    else if (control.matches('[data-bf-late]')) lateFile(sim, day, LATE_BY);
    else if (control.matches('[data-bf-clear]')) {
      clear(sim, day);
      if (sim.lines.at(-1) === before)
        words = sim.runs[day]
          ? `${weekday(day)}'s run has not started, so there is nothing to clear.`
          : `${weekday(day)} has no run to clear while the job is off.`;
    } else return;
    draw();
    // What the press set off, in the log's words: its lines, up to the last four of them.
    const added = sim.lines.slice(before ? sim.lines.indexOf(before) + 1 : 0).slice(-4);
    const told = added.map((line) => `${line.text}.`).join(' ');
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
  still.addEventListener('change', () => {
    if (playing) {
      pause();
      play();
    }
  });

  pick(day);
  if (hashed === null) shownLine = sim.lines.at(-1);
  else lines?.replaceChildren();
  draw();
  for (const control of queued) press(control);
}
