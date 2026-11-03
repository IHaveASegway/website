import { eventLog } from '../../lib/lab/event-log';
import { runOnLanding } from '../../lib/lab/landing-run';
import {
  crash,
  heal,
  leaderOf,
  playTo,
  replay,
  restart,
  setLoss,
  split,
  step,
  write,
  type Action,
  type Sim,
} from '../../lib/raft/sim';
import {
  cutFence,
  eventsWords,
  flightsMarkup,
  landingStory,
  linkTo,
  logMarkup,
  logWords,
  OPENING,
  propertyWord,
  readRun,
  seconds,
  serverState,
  statusText,
  summary,
  timerShare,
} from '../../lib/raft/view';
import { curled } from '../../lib/typeset.mjs';

// The Raft Lab in the browser (ADR 0020): the simulation, run in virtual time and drawn on every
// frame while it runs. It opens paused, on the same opening the build drew, and moves when the
// visitor presses Run, which Pause stops (SC 2.2.2), or when they land on it (below); a hidden tab
// pauses it too. Run says what it does next, Run or Pause, and has no pressed state, as the other
// labs' Run does. With reduced motion, messages do not glide: each one stands half way along its
// path, and Run advances in still steps, half a second of the chosen speed twice a second. A link to
// a run (lib/sim/link.ts) names its seed and the share of messages it loses (#seed-8&loss=30), and
// opens that run's opening, paused, on load or when followed on the page. Start over keeps the seed
// and the loss, as the other labs do, so the run can be watched again, and writes the link to it.
//
// The run a visitor lands on tells a story (lib/raft/view.ts, landingStory): the leader crashes and
// the others elect a new one. It's the landing's alone: a press drops what's left of it, and the demo
// is theirs. So a press of Run never brings a crash nobody asked for, and neither do Pause and Run or
// a link. A visitor who presses gets what their presses make. Start over is the one press that asks
// for that run again, so on a run with no other press in it, it tells the story again, once, as the
// Queue Lab's brings its crash back; the same run a visitor just watched can be watched again.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 4_000;
const STILL_EVERY = 500; // real ms between steps under reduced motion

/**
 * A seed's opening, as the build draws seed 7's, with `loss` of the messages lost from the
 * opening's moment on: the share the slider is set to. The loss is an action like any other,
 * recorded at that moment, so the run's actions replay it; with none lost, nothing is recorded,
 * and the run is the build's for its seed.
 */
export function fresh(seed: number, loss: number): Sim {
  const sim = replay({ seed }, OPENING.actions, OPENING.until);
  if (loss > 0) setLoss(sim, loss);
  return sim;
}

export function start(root: HTMLElement, queued: readonly Element[]): () => void {
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const flights = $<SVGGElement>('[data-rf-flights]');
  const cut = $<SVGPathElement>('[data-rf-cut]');
  const run = $<HTMLButtonElement>('[data-rf-run]');
  const loss = $<HTMLInputElement>('[data-rf-loss]');
  const lossOut = $<HTMLOutputElement>('[data-rf-loss-out]');
  // The speed is the chosen radio's, read on every frame, so a choice made before the app loaded
  // counts too.
  const speed = () => Number($<HTMLInputElement>('[name="rf-speed"]:checked')?.value ?? 0.05);
  const said = $('[data-rf-said]');
  const text = (element: Element | null, value: string) => {
    const words = curled(value);
    if (element && element.textContent !== words) element.textContent = words;
  };

  /** The share of messages lost that the slider is set to, in percent, and as a share. */
  const percent = () => Number(loss?.value ?? 0);
  const lost = () => percent() / 100;
  /** Sets the slider to a run's loss: the link's, or none for the build's run. */
  const showLoss = (value: number) => {
    if (loss) loss.value = String(value);
    if (lossOut) lossOut.textContent = `${value}%`;
  };

  // A link names the run, its loss included; without one the run is the build's, which loses
  // none, whatever the slider kept from an earlier visit. A slider moved before the app arrived is
  // the visitor's, and plays as a press below.
  const linked = readRun(location.hash);
  if (!queued.includes(loss as Element)) showLoss(linked?.loss ?? 0);
  let sim: Sim = fresh(linked?.seed ?? OPENING.seed, (linked?.loss ?? 0) / 100);
  /** What's left of the story the run a visitor lands on tells, none once the demo is theirs. */
  let ahead: Action[] = [];
  /** When that story is over, so the landing run can stand a moment and go round again. */
  let storyEnds = Infinity;
  /** Whether the run is the one they landed on, with no press in it but Start over. */
  let told = false;
  /** Whether the visitor has pressed anything or followed a link: then no landing starts for them. */
  let theirs = false;
  let playing = false;
  let last = 0;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let shownBroken: string | undefined;
  const shownLogs: string[] = [];
  // The build wrote the opening's last lines; a link's run writes its own.
  const log = eventLog(
    $('[data-rf-lines]') as HTMLElement,
    'lab-log-at',
    seconds,
    linked ? undefined : sim.lines.at(-1),
  );
  if (linked) log.clear();

  /** Everything the page shows of the run, changed only where it changed. */
  function draw(): void {
    for (const s of sim.servers) {
      const node = $(`[data-rf-node="${s.id}"]`);
      node?.setAttribute('data-role', s.role);
      node?.setAttribute('data-up', String(s.up));
      node
        ?.querySelector('[data-rf-dial]')
        ?.setAttribute('stroke-dasharray', `${timerShare(s, sim.now).toFixed(3)} 1`);
      text($(`[data-rf-node="${s.id}"] [data-rf-role]`), s.up ? s.role : 'down');
      text($(`[data-rf-node="${s.id}"] [data-rf-term]`), `term ${s.term}`);
      const row = $(`[data-rf-log="${s.id}"]`);
      const markup = logMarkup(s);
      if (row && shownLogs[s.id] !== markup) {
        row.innerHTML = markup;
        row.setAttribute('aria-label', `Server ${s.id + 1}: ${logWords(s)}`);
        shownLogs[s.id] = markup;
      }
      const toggle = $(`[data-rf-toggle="${s.id}"]`);
      const words = `${s.up ? 'Crash' : 'Restart'} server ${s.id + 1}`;
      text(toggle, words);
      toggle?.setAttribute('aria-label', `${words}, now ${serverState(s)}`);
    }
    if (flights) flights.innerHTML = flightsMarkup(sim, still.matches);
    const fence = cutFence(sim.groups);
    if (cut) {
      if (fence) {
        cut.removeAttribute('data-off');
        if (cut.getAttribute('d') !== fence) cut.setAttribute('d', fence);
      } else cut.setAttribute('data-off', '');
    }
    text($('[data-rf-summary]'), summary(sim));
    // A property breaks at most once in a run, and that stops the run, so this rarely has work.
    const broken = sim.violation?.property;
    if (broken !== shownBroken) {
      shownBroken = broken;
      for (const row of root.querySelectorAll('[data-rf-prop]')) {
        const held = row.getAttribute('data-rf-prop') !== broken;
        row.setAttribute('data-held', String(held));
        text(row.querySelector('[data-rf-prop-word]'), propertyWord(held));
      }
    }
    text($('[data-rf-status]'), statusText(sim));
    text($('[data-rf-clock]'), `Virtual time ${seconds(sim.now)}`);
    text($('[data-rf-events]'), eventsWords(sim));
    text($('[data-rf-seed]'), String(sim.seed));
    log.draw(sim.lines);
  }

  const say = (words: string) => {
    if (said) said.textContent = curled(words);
  };

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    if (run) run.textContent = 'Run';
    run?.setAttribute('data-lamp', 'off');
    draw();
  }

  /** Shows another run from its opening, paused, and says what it shows: Start over's, a link's, or
   *  the landing run going round again. */
  function open(next: Sim): void {
    pause();
    sim = next;
    ahead = [];
    log.clear();
    draw();
    say(summary(sim));
  }

  function tick(now: number): void {
    if (!playing) return;
    const elapsed = Math.min(FRAME_CAP, now - last);
    last = now;
    playTo(sim, ahead, sim.now + elapsed * speed(), EVENTS_PER_FRAME);
    draw();
    if (sim.violation) {
      say(statusText(sim));
      pause();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function play(): void {
    if (sim.violation) return;
    playing = true;
    if (run) run.textContent = 'Pause';
    run?.setAttribute('data-lamp', 'on');
    if (still.matches) {
      timer = setInterval(() => {
        playTo(sim, ahead, sim.now + STILL_EVERY * speed(), EVENTS_PER_FRAME);
        draw();
        if (sim.violation) pause();
      }, STILL_EVERY);
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** A side of two: the leader and the server after it, or servers 1 and 2 with no leader. */
  function twoAndThree(): number[] {
    const leader = leaderOf(sim)?.id ?? 0;
    const size = sim.servers.length;
    return sim.servers.map((s) => (s.id === leader || s.id === (leader + 1) % size ? 1 : 0));
  }

  /** Starts the story over from where the run stands, its opening. */
  function tell(): void {
    const story = landingStory(sim);
    ahead = story.actions;
    storyEnds = story.ends;
    told = true;
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    theirs = true;
    // Every press but Start over drops what's left of the story: Start over asks for it again.
    const reset = control.matches('[data-rf-reset]');
    if (!reset) {
      told = false;
      ahead = [];
    }
    const node = control.closest('[data-rf-node], [data-rf-toggle]');
    const id = node?.getAttribute('data-rf-node') ?? node?.getAttribute('data-rf-toggle');
    if (id !== null && id !== undefined) {
      const s = sim.servers[Number(id)];
      if (s?.up) crash(sim, s.id);
      else if (s) restart(sim, s.id);
    } else if (control.matches('[data-rf-run]')) {
      if (playing) pause();
      else play();
    } else if (control.matches('[data-rf-step]')) {
      step(sim);
    } else if (control.matches('[data-rf-write]')) {
      write(sim);
    } else if (control.matches('[data-rf-lone]')) {
      const leader = leaderOf(sim);
      if (leader)
        split(
          sim,
          sim.servers.map((s) => (s.id === leader.id ? 1 : 0)),
        );
      else say('There is no leader to cut off right now.');
    } else if (control.matches('[data-rf-split]')) {
      split(sim, twoAndThree());
    } else if (control.matches('[data-rf-heal]')) {
      heal(sim);
    } else if (reset) {
      const wasPlaying = playing;
      open(fresh(sim.seed, lost()));
      if (told) tell();
      // The address names the run, its loss and all, so a reload or the link shared opens it.
      history.replaceState(null, '', linkTo(sim.seed, percent()));
      if (wasPlaying) play();
      return;
    } else if (control.matches('[data-rf-loss]') && loss) {
      // Before it changes the loss, the run finishes the events due in this millisecond, as any
      // action does (lib/raft/sim.ts, catchUp), so the page draws what they did.
      setLoss(sim, lost());
      if (lossOut) lossOut.textContent = `${loss.value}%`;
    } else return;
    const latest = sim.lines.at(-1);
    if (latest && latest !== before) say(latest.text);
    // An event the log does not tell, as most are: where the run stands now, so the press is heard.
    else if (control.matches('[data-rf-step]'))
      say(`Virtual time ${seconds(sim.now)}, ${eventsWords(sim)}`);
    draw();
  }

  // A label too, though it does nothing here: the speed already chosen fires no input, and it's as
  // much a first press as any (lib/lab/landing-run.ts).
  root.addEventListener('click', (event) => {
    const control = (event.target as Element).closest('button, label, [data-rf-node]');
    if (control) press(control);
  });
  root.addEventListener('input', (event) => press(event.target as Element));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) pause();
  });
  // A link to a run followed on this page opens that run's opening, paused, as loading it would.
  addEventListener('hashchange', () => {
    const link = readRun(location.hash);
    if (!link) return;
    theirs = true;
    told = false;
    showLoss(link.loss);
    open(fresh(link.seed, link.loss / 100));
  });
  still.addEventListener('change', () => {
    if (playing) {
      pause();
      play();
    }
  });

  draw();
  for (const control of queued) press(control);
  // The run a visitor lands on goes on from the moment the picture tells, with its story ahead. A
  // visitor who already pressed something, while the top bar's Pause kept the landing waiting, has
  // their demo already, and nothing here takes it back.
  return () => {
    if (theirs) return;
    tell();
    runOnLanding(root, {
      play,
      pause,
      playing: () => playing,
      finished: () => Boolean(sim.violation) || sim.now >= storyEnds,
      again: () => {
        open(fresh(sim.seed, lost()));
        tell();
        play();
      },
    });
  };
}
