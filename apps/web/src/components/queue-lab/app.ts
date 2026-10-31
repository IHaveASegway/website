import { properties } from '../../lib/queue/check';
import { valueOf, word } from '../../lib/sim/link';
import {
  crash,
  nextTime,
  poison,
  restart,
  setAck,
  setKey,
  setLoad,
  setPoisonHandling,
  setPrefetch,
  slow,
  startProducer,
  stopProducer,
  type Line,
  type Sim,
} from '../../lib/queue/sim';
import {
  aheadOf,
  capacityWords,
  LAYOUTS,
  linkTo,
  mapMarkup,
  OPENING,
  openingRun,
  openLink,
  playTo,
  propertyWords,
  REPLAY_FROM,
  seconds,
  SETTINGS,
  startOver,
  statusText,
  STRIP,
  strip,
  stripWords,
  summary,
  tenths,
  waitWords,
  type Crash,
} from '../../lib/queue/view';

// The Queue Lab in the browser (ADR 0020's pattern): the simulation, run in virtual time and drawn
// on every frame while it runs. It opens paused, on the same opening the build drew, and moves only
// when the visitor presses Run, which Pause stops (SC 2.2.2); a hidden tab pauses it too. The
// opening's picture tells a crash that has already happened, so Run on a run still standing
// untouched at that moment plays it again from REPLAY_FROM, as Start over does: the visitor
// watches worker 2 crash and order 18 print twice, rather than reading that it did. Each frame
// runs the core to a whole millisecond, as replay does, never event by event, and takes the
// opening's crash at its moment (view.ts, playTo), so the run a visitor makes is the run its
// recorded actions replay. With reduced motion, Run moves in still steps: half a second of the
// chosen speed, twice a second. A link to a run (lib/sim/link.ts) opens it, paused at the
// opening's moment, on load or when followed on the page; Start over writes the link to the run
// it plays.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 4_000;
const STILL_EVERY = 500; // real ms between steps under reduced motion

/** What a choice of each setting does to the run. */
const SETTERS = {
  load: setLoad,
  prefetch: setPrefetch,
  ack: setAck,
  key: setKey,
  handling: setPoisonHandling,
} satisfies Record<keyof typeof SETTINGS, unknown>;

/** The setting a group of choices sets, by its name, qu-ack for the ack; null for the speed. */
const setting = (group: string): keyof typeof SETTINGS | null => {
  const name = group.slice(3);
  return Object.hasOwn(SETTINGS, name) ? (name as keyof typeof SETTINGS) : null;
};

export function start(root: HTMLElement, queued: readonly Element[]): void {
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const maps = [...root.querySelectorAll<SVGSVGElement>('[data-qu-map]')];
  const run = $<HTMLButtonElement>('[data-qu-run]');
  const lines = $<HTMLOListElement>('[data-qu-lines]');
  const said = $('[data-qu-said]');
  const chart = $<SVGSVGElement>('[data-qu-strip]');
  const curve = $<SVGPolylineElement>('[data-qu-strip-line]');
  const ticks = $<SVGGElement>('[data-qu-crashes]');
  const text = (element: Element | null, value: string) => {
    if (element && element.textContent !== value) element.textContent = value;
  };
  const attribute = (element: Element | null, name: string, value: string) => {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  };

  let sim: Sim = openLink(location.hash) ?? openingRun();
  /** The opening's crashes this run has still to take: none at the opening's moment, worker 2's
   *  once started over. */
  let ahead: Crash[] = [];
  /** Whether the run stands where the picture told it, untouched: opened at the opening's moment,
   *  and neither played nor stepped since. A press that changes the run is an action it records. */
  let told = true;
  let speed = 1;
  let playing = false;
  let last = 0;
  /** Virtual ms with the fraction the frames have run: the core moves in whole ones. */
  let clock = sim.now;
  let frame = 0;
  let timer = 0;
  let shownLines: Line | undefined;
  const shownMaps = new Map<SVGSVGElement, string>();
  /** The layout the page shows (queue-lab.css): the other one is not drawn until it shows. */
  let showing = maps.filter((map) => map.getClientRects().length > 0);
  // The build wrote the opening's last lines; the run writes its own from the first draw, so none
  // is written twice.
  lines?.replaceChildren();

  /** Everything the page shows of the run, changed only where it changed. */
  function draw(): void {
    for (const map of showing) {
      const layout = map.dataset['quMap'] === 'narrow' ? LAYOUTS.narrow : LAYOUTS.wide;
      const markup = mapMarkup(sim, layout);
      if (shownMaps.get(map) !== markup) {
        map.innerHTML = markup;
        shownMaps.set(map, markup);
      }
    }
    const history = strip(sim);
    attribute(curve, 'points', history.points);
    const crashes = history.crashes
      .map((c) => `<path class="qu-strip-crash" d="M${c.x} 0V${STRIP.height}"/>`)
      .join('');
    if (ticks && ticks.innerHTML !== crashes) ticks.innerHTML = crashes;
    attribute(chart, 'aria-label', stripWords(sim));
    text($('[data-qu-most]'), String(history.most));
    text($('[data-qu-from]'), tenths(history.from));
    text($('[data-qu-to]'), tenths(history.to));
    text($('[data-qu-wait]'), waitWords(sim));
    text($('[data-qu-capacity]'), capacityWords(sim));
    for (const p of properties(sim)) {
      const item = $(`[data-qu-prop="${p.id}"]`);
      attribute(item, 'data-held', String(p.held));
      text(item?.querySelector('[data-qu-prop-words]') ?? null, propertyWords(sim, p));
    }
    text($('[data-qu-summary]'), summary(sim));
    text($('[data-qu-status]'), statusText(sim));
    text($('[data-qu-clock]'), `Virtual time ${seconds(sim.now)}`);
    text($('[data-qu-seed]'), String(sim.seed));
    for (const w of sim.workers.slice(0, sim.size)) {
      const n = w.id + 1;
      const crashing = $(`[data-qu-crash="${w.id}"]`);
      const verb = w.state === 'up' ? 'Crash' : 'Restart';
      text(crashing, verb);
      attribute(crashing, 'aria-label', `${verb} worker ${n}`);
      const slowing = $(`[data-qu-slow="${w.id}"]`);
      text(slowing, w.slow ? 'Normal' : 'Slow');
      attribute(
        slowing,
        'aria-label',
        w.slow ? `Normal speed for worker ${n}` : `Slow down worker ${n}`,
      );
    }
    text($('[data-qu-producer]'), sim.producing ? 'Stop taking orders' : 'Take orders');
    // The choices follow the run: Start over and a link to a run set them too. Each group is a
    // setting (view.ts, SETTINGS) and names its values as a link does, but for the speed.
    for (const radio of root.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const name = setting(radio.name);
      const on = radio.value === (name ? word(sim[name]) : String(speed));
      if (radio.checked !== on) radio.checked = on;
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
      at.className = 'qu-at';
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

  /** Runs the core on by some virtual ms, to a whole one, within a frame's budget of events. */
  function advance(by: number): void {
    clock = Math.max(clock, sim.now) + by;
    const target = Math.floor(clock);
    if (target > sim.now) playTo(sim, ahead, target, EVENTS_PER_FRAME);
    // The budget ran out before the target: the clock waits for the run instead of leaping.
    if (sim.now < target) clock = sim.now;
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

  /** Shows another run from its opening: Start over's, with the crash still ahead, or a link's.
   *  Said where it stands: started over, the clock, since nothing has happened yet to tell;
   *  otherwise its caption. */
  function open(next: Sim, pending: Crash[], resume: boolean): void {
    pause();
    sim = next;
    ahead = pending;
    clock = sim.now;
    shownLines = undefined;
    lines?.replaceChildren();
    draw();
    say(ahead.length > 0 ? `Virtual time ${seconds(sim.now)}` : summary(sim));
    if (resume) play();
  }

  /** The run again from REPLAY_FROM, the one its link names: Start over keeps the seed and the
   *  settings, and worker 2's crash is still to come. */
  function begin(resume: boolean): void {
    open(startOver(sim, REPLAY_FROM), aheadOf(REPLAY_FROM), resume);
    told = false;
  }

  function stopped(): boolean {
    if (!sim.violation) return false;
    say(statusText(sim));
    pause();
    return true;
  }

  function tick(now: number): void {
    if (!playing) return;
    advance(Math.min(FRAME_CAP, now - last) * speed);
    last = now;
    draw();
    if (!stopped()) frame = requestAnimationFrame(tick);
  }

  function play(): void {
    if (sim.violation) return;
    told = false;
    playing = true;
    text(run, 'Pause');
    attribute(run, 'data-lamp', 'on');
    if (still.matches) {
      timer = window.setInterval(() => {
        advance(STILL_EVERY * speed);
        draw();
        stopped();
      }, STILL_EVERY);
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** A choice from one of the radio groups: the speed, or a setting, by the value it names. */
  function choose(group: string, value: string): void {
    const name = setting(group);
    if (!name) {
      speed = Number(value) || 1;
      if (playing) {
        pause();
        play();
      }
      return;
    }
    const chosen = valueOf(SETTINGS[name], value);
    if (chosen !== undefined) SETTERS[name](sim, chosen as never);
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    if (control instanceof HTMLInputElement && control.type === 'radio') {
      if (!control.checked) return;
      choose(control.name, control.value);
      if (!setting(control.name)) return;
    } else if (control.matches('[data-qu-run]')) {
      if (playing) pause();
      // Still the moment the picture tells, untouched: play the crash it told, as it happens.
      else if (told && sim.actions.length === OPENING.actions.length) begin(true);
      else play();
      return;
    } else if (control.matches('[data-qu-step]')) {
      // The next event, or the opening's crash when it comes first: a crash is a moment too.
      const next = Math.min(nextTime(sim), ahead[0]?.at ?? Infinity);
      if (Number.isFinite(next)) playTo(sim, ahead, next);
      told = false;
      clock = sim.now;
      if (!Number.isFinite(next)) say('Nothing more happens until you act.');
      else if (sim.lines.at(-1) === before) say(`Virtual time ${seconds(sim.now)}`);
      stopped();
    } else if (control.matches('[data-qu-reset]')) {
      begin(playing);
      // The address names the run, settings and all, so a reload or the link shared opens it.
      history.replaceState(null, '', linkTo(sim));
      return;
    } else if (control.matches('[data-qu-producer]')) {
      if (sim.producing) stopProducer(sim);
      else startProducer(sim);
    } else if (control.matches('[data-qu-poison]')) {
      poison(sim);
    } else if (control.matches('[data-qu-crash]')) {
      const w = sim.workers[Number(control.getAttribute('data-qu-crash'))];
      if (w?.state === 'up') crash(sim, w.id);
      else if (w) restart(sim, w.id);
    } else if (control.matches('[data-qu-slow]')) {
      const w = sim.workers[Number(control.getAttribute('data-qu-slow'))];
      if (w) slow(sim, w.id, !w.slow);
    } else return;
    const latest = sim.lines.at(-1);
    if (latest && latest !== before) say(latest.text);
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
    const linked = openLink(location.hash);
    if (linked) {
      open(linked, [], false);
      told = true;
    }
  });
  still.addEventListener('change', () => {
    if (playing) {
      pause();
      play();
    }
  });
  // The layout follows the page's width: when the other picture shows, it is drawn then.
  const sized = new ResizeObserver(() => {
    showing = maps.filter((map) => map.getClientRects().length > 0);
    draw();
  });
  for (const map of maps) sized.observe(map);

  // The choices made while the app loaded are read before any is played: playing one draws the
  // page, and the draw sets every radio from the run, which unchecked a later choice before its
  // turn (a slow load lost "Rush" after "On"). Each is checked again as its turn comes.
  const chosen = new Set(
    queued.filter((control) => control instanceof HTMLInputElement && control.checked),
  );
  for (const control of queued) {
    if (control instanceof HTMLInputElement && chosen.has(control)) control.checked = true;
    press(control);
  }
  draw();
}
