import { properties } from '../../lib/queue/check';
import {
  crash,
  nextTime,
  poison,
  restart,
  runUntil,
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
  LAYOUTS,
  mapMarkup,
  OPENING,
  openingOf,
  propertyWords,
  seconds,
  startOver,
  statusText,
  STRIP,
  strip,
  stripWords,
  summary,
  tenths,
  waitWords,
} from '../../lib/queue/view';

// The Queue Lab in the browser (ADR 0020's pattern): the simulation, run in virtual time and drawn
// on every frame while it runs. It opens paused, on the same opening the build drew, and moves only
// when the visitor presses Run, which Pause stops (SC 2.2.2); a hidden tab pauses it too. Each
// frame runs the core with runUntil to a whole millisecond, as replay does, never event by event,
// so the run a visitor makes is the run its recorded actions replay. With reduced motion, Run
// moves in still steps: half a second of the chosen speed, twice a second.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 4_000;
const STILL_EVERY = 500; // real ms between steps under reduced motion

const seedFromHash = (): number | null => {
  const match = /^#seed-(\d{1,6})$/.exec(location.hash);
  return match ? Number(match[1]) : null;
};

const ACKS = ['after', 'before'] as const;
const LOADS = ['calm', 'busy', 'rush'] as const;
const HANDLINGS = ['requeue', 'dead-letter'] as const;
const known = <T extends string>(values: readonly T[], value: string): T | undefined =>
  values.find((v) => v === value);

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

  const hashed = seedFromHash();
  let sim: Sim = openingOf(hashed ?? OPENING.seed);
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
    // The choices follow the run: Start over and a link to a run set them too.
    const chosen: Record<string, string> = {
      'qu-speed': String(speed),
      'qu-ack': sim.ack,
      'qu-key': sim.key ? 'on' : 'off',
      'qu-prefetch': String(sim.prefetch),
      'qu-load': sim.load,
      'qu-handling': sim.handling,
    };
    for (const radio of root.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const on = chosen[radio.name] === radio.value;
      if (radio.checked !== on) radio.checked = on;
    }
    drawLines();
  }

  /** The event log: new lines appended, the oldest dropped past 60. */
  function drawLines(): void {
    if (!lines) return;
    const from = shownLines ? sim.lines.indexOf(shownLines) + 1 : 0;
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
    const box = lines.parentElement;
    if (box && sim.lines.length > first) box.scrollTop = box.scrollHeight;
    shownLines = sim.lines.at(-1);
  }

  const say = (words: string) => {
    if (said) said.textContent = words;
  };

  /** Runs the core on by some virtual ms, to a whole one, within a frame's budget of events. */
  function advance(by: number): void {
    clock = Math.max(clock, sim.now) + by;
    const target = Math.floor(clock);
    if (target > sim.now) runUntil(sim, target, EVENTS_PER_FRAME);
    // The budget ran out before the target: the clock waits for the run instead of leaping.
    if (sim.now < target) clock = sim.now;
  }

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    text(run, 'Run');
    draw();
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
    playing = true;
    text(run, 'Pause');
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

  /** A choice from one of the radio groups. */
  function choose(name: string, value: string): void {
    if (name === 'qu-speed') {
      speed = Number(value) || 1;
      if (playing) {
        pause();
        play();
      }
      return;
    }
    const ack = known(ACKS, value);
    const load = known(LOADS, value);
    const handling = known(HANDLINGS, value);
    if (name === 'qu-ack' && ack) setAck(sim, ack);
    else if (name === 'qu-key') setKey(sim, value === 'on');
    else if (name === 'qu-prefetch') setPrefetch(sim, Number(value));
    else if (name === 'qu-load' && load) setLoad(sim, load);
    else if (name === 'qu-handling' && handling) setPoisonHandling(sim, handling);
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    if (control instanceof HTMLInputElement && control.type === 'radio') {
      if (!control.checked) return;
      choose(control.name, control.value);
      if (control.name === 'qu-speed') return;
    } else if (control.matches('[data-qu-run]')) {
      if (playing) pause();
      else play();
      return;
    } else if (control.matches('[data-qu-step]')) {
      const next = nextTime(sim);
      if (Number.isFinite(next)) runUntil(sim, next);
      clock = sim.now;
      if (!Number.isFinite(next)) say('Nothing more happens until you act.');
      else if (sim.lines.at(-1) === before) say(`Virtual time ${seconds(sim.now)}`);
      stopped();
    } else if (control.matches('[data-qu-reset]')) {
      const wasPlaying = playing;
      pause();
      sim = startOver(sim);
      clock = sim.now;
      shownLines = undefined;
      lines?.replaceChildren();
      draw();
      say(summary(sim));
      if (wasPlaying) play();
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

  for (const control of queued) press(control);
  draw();
}
