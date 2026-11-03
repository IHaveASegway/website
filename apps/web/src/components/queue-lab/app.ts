import { eventLog } from '../../lib/lab/event-log';
import { runOnLanding } from '../../lib/lab/landing-run';
import { speaker, startsOver, type Say } from '../../lib/lab/said';
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
  type Sim,
} from '../../lib/queue/sim';
import {
  AGAIN,
  aheadOf,
  capacityWords,
  eventsWords,
  LAYOUTS,
  linkTo,
  mapMarkup,
  OPENING,
  openingRun,
  openLink,
  playTo,
  propertyWords,
  REPLAY_FROM,
  REPLAY_WORDS,
  seconds,
  SETTINGS,
  startOver,
  statusText,
  stopWords,
  STORY,
  STRIP,
  strip,
  stripWords,
  summary,
  tenths,
  waitWords,
  type Crash,
} from '../../lib/queue/view';

// The Queue Lab in the browser (ADR 0020's pattern): the simulation, run in virtual time and drawn
// on every frame while it runs. It takes over the same opening the build drew. A visitor who didn't
// ask for less motion lands on it running (ADR 0030); otherwise it moves only when they press Run,
// which Pause stops (SC 2.2.2), and a hidden tab pauses it too.
//
// The controls mean what they mean in every lab (docs/lab.md, "The controls"). The opening's picture
// tells a crash that has already happened, so Run on a run still standing at that moment, with
// nothing done since but a choice of settings, plays it again from REPLAY_FROM, and so does Run when
// nothing is left to happen. Start over goes back there too and writes the link to the run it plays.
// So does a choice of the setting that decides the story (view.ts, STORY): the visitor watches
// worker 2 crash and order 18 print once under the key, rather than read that it did. Each frame
// runs the core to a whole millisecond, as replay does, never event by event, and takes the opening's
// crash at its moment (view.ts, playTo), so the run a visitor makes is the run its recorded actions
// replay. With reduced motion, Run moves in still steps: half a second of the chosen speed, twice a
// second. A link to a run (lib/sim/link.ts) opens it, paused at the opening's moment, on load or when
// followed on the page.

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

export function start(root: HTMLElement, queued: readonly Element[]): () => void {
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const maps = [...root.querySelectorAll<SVGSVGElement>('[data-qu-map]')];
  const run = $<HTMLButtonElement>('[data-qu-run]');
  const lines = $<HTMLOListElement>('[data-qu-lines]');
  const chart = $<SVGSVGElement>('[data-qu-strip]');
  const curve = $<SVGPolylineElement>('[data-qu-strip-line]');
  const ticks = $<SVGGElement>('[data-qu-crashes]');
  const text = (element: Element | null, value: string) => {
    if (element && element.textContent !== value) element.textContent = value;
  };
  const attribute = (element: Element | null, name: string, value: string) => {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  };

  const linked = openLink(location.hash);
  let sim: Sim = linked ?? openingRun();
  /** The opening's crashes this run has still to take: none at the opening's moment, worker 2's
   *  once started over. */
  let ahead: Crash[] = [];
  /** Whether the run stands where the picture told it: opened at the opening's moment, and neither
   *  played nor stepped since. */
  let told = true;
  let speed = 1;
  let playing = false;
  let last = 0;
  /** Virtual ms with the fraction the frames have run: the core moves in whole ones. */
  let clock = sim.now;
  let frame = 0;
  let timer = 0;
  const shownMaps = new Map<SVGSVGElement, string>();
  /** The layout the page shows (queue-lab.css): the other one is not drawn until it shows. */
  let showing = maps.filter((map) => map.getClientRects().length > 0);
  // The build wrote the opening's last lines; a link's run writes its own.
  const log = eventLog(lines, 'lab-log-at', seconds, linked ? undefined : sim.lines.at(-1));
  if (linked) log.clear();
  const tell = speaker(root, $('[data-qu-said]'));
  /** While the run is the one a visitor landed on, nobody's choice yet, it says nothing. */
  let landing = false;
  const say: Say = (words, control, short) => {
    if (!landing) tell(words, control, short);
  };

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
    text($('[data-qu-events]'), eventsWords(sim));
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
    log.draw(sim.lines);
  }

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

  /** Shows another run from its opening: Start over's, with the crash still ahead, or a link's. */
  function open(next: Sim, pending: Crash[], resume: boolean): void {
    pause();
    sim = next;
    ahead = pending;
    clock = sim.now;
    log.clear();
    draw();
    if (resume) play();
  }

  /** The run again from REPLAY_FROM, the one its link names: the seed and the settings stay, and
   *  worker 2's crash is still to come. */
  function begin(resume: boolean): void {
    open(startOver(sim, REPLAY_FROM), aheadOf(REPLAY_FROM), resume);
    told = false;
  }

  /** Whether nothing is left to happen: no order is coming, and the queue has drained or no worker
   *  is up to take what waits. */
  const over = () =>
    !sim.violation && !Number.isFinite(Math.min(nextTime(sim), ahead[0]?.at ?? Infinity));

  /** Whether the run stands where the picture told it, with nothing done since but a choice of
   *  settings: then Run plays what the picture told, under those settings, as it happens. */
  const untouched = () =>
    told && sim.actions.slice(OPENING.actions.length).every((action) => action.kind in SETTINGS);

  function stopped(): boolean {
    if (sim.violation) {
      say(statusText(sim));
      pause();
      return true;
    }
    if (over()) {
      say(stopWords(sim));
      pause();
      return true;
    }
    return false;
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
      const name = setting(control.name);
      choose(control.name, control.value);
      if (!name) return;
      if (STORY.includes(name)) {
        // The address names the run, so a reload or the link shared opens it, as Start over's does.
        const line = sim.lines.at(-1)?.text ?? '';
        const wasPlaying = playing;
        begin(wasPlaying);
        history.replaceState(null, '', linkTo(sim));
        const started = startsOver('run', 'it', REPLAY_WORDS, wasPlaying);
        say(`${line}. ${started}`, control, `${line.split(':')[0]}. ${started}`);
        return;
      }
    } else if (control.matches('[data-qu-run]')) {
      if (playing) pause();
      else if (untouched() || over()) {
        begin(true);
        say(AGAIN, control);
      } else {
        play();
        say('', control);
      }
      return;
    } else if (control.matches('[data-qu-step]')) {
      if (over()) {
        begin(false);
        say(AGAIN, control);
        return;
      }
      // The next event, or the opening's crash when it comes first: a crash is a moment too.
      playTo(sim, ahead, Math.min(nextTime(sim), ahead[0]?.at ?? Infinity));
      told = false;
      clock = sim.now;
      if (sim.lines.at(-1) === before) say(`Virtual time ${seconds(sim.now)}`, control);
      stopped();
    } else if (control.matches('[data-qu-reset]')) {
      const wasPlaying = playing;
      begin(wasPlaying);
      // The address names the run, settings and all, so a reload or the link shared opens it.
      history.replaceState(null, '', linkTo(sim));
      say(startsOver('run', 'these settings', REPLAY_WORDS, wasPlaying), control);
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
    if (latest && latest !== before) say(latest.text, control);
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
    if (next) {
      open(next, [], false);
      told = true;
      say(summary(sim));
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
  // The run a visitor lands on plays the crash the picture told, as Run does, and again.
  return () => {
    landing = true;
    runOnLanding(root, {
      play: () => {
        if (untouched()) begin(true);
        else play();
      },
      pause,
      playing: () => playing,
      finished: () => Boolean(sim.violation) || over(),
      again: () => begin(true),
      taken: () => {
        landing = false;
      },
    });
  };
}
