import { eventLog } from '../../lib/lab/event-log';
import { heldByThePage, runOnLanding } from '../../lib/lab/landing-run';
import { speaker, watchIt } from '../../lib/lab/said';
import { address } from '../../lib/sim/link';
import {
  crash,
  heal,
  leaderOf,
  nextTime,
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
import type { Server } from '../../lib/raft/core';
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
  STORY_ENDS,
  summary,
  timerShare,
} from '../../lib/raft/view';

// The Raft Lab in the browser (ADR 0020): the simulation, run in virtual time and drawn on every
// frame while it runs. It opens paused, on the same opening the build drew, and moves when the
// visitor presses Run, which Pause stops (SC 2.2.2), or when they land on it (below); a hidden tab
// pauses it too. Run says what it does next, Run or Pause, and has no pressed state, as the other
// labs' Run does. With reduced motion, messages do not glide: each one stands half way along its
// path, and Run advances in still steps, half a second of the chosen speed twice a second. A link to
// a run (lib/sim/link.ts) names its seed and the share of messages it loses (#seed-8&loss=30), and
// opens that run's opening, paused, on load or when followed on the page. Start over keeps the seed
// and the loss, as the other labs do, so the run can be watched again, and writes the link to it.
// What a press did, or why it did nothing, goes on the line under Time and to one live region
// (lib/lab/said.ts); the run a visitor lands on says nothing in either.
//
// The run the page opens on has a story ahead of it (lib/raft/view.ts, landingStory): the leader
// crashes and the others elect a new one, as the other labs' runs have their failure. Time's controls
// play the run and don't change it, so Pause, Run, a speed and Next event leave the story where it
// is, and Run as a first press plays it, under reduced motion too. A press that changes the run, a
// crash or a write or a split, drops what's left of it, since a crash that came after one would be the
// page breaking something the visitor was using. A link names another run, which never holds it.
// Start over asks for the run again, so on a run with the story still in it, it tells it again, once.

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
  // The page always draws what this looks for, and loads this only there.
  const $ = (selector: string) => root.querySelector(selector) as Element;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const flights = $('[data-rf-flights]');
  const cut = $('[data-rf-cut]');
  const run = $('[data-rf-run]');
  const loss = $('[data-rf-loss]') as HTMLInputElement;
  const lossOut = $('[data-rf-loss-out]');
  // The speed is the chosen radio's, read on every frame, so a choice made before the app loaded
  // counts too.
  const speed = () => Number(($('[name="rf-speed"]:checked') as HTMLInputElement).value);
  const text = (element: Element, words: string) => {
    if (element.textContent !== words) element.textContent = words;
  };

  /** The share of messages lost that the slider is set to, in percent, and as a share. */
  const percent = () => Number(loss.value);
  const lost = () => percent() / 100;
  /** Sets the slider to a run's loss: the link's, or none for the build's run. */
  const showLoss = (value: number) => {
    loss.value = String(value);
    lossOut.textContent = `${value}%`;
  };

  // A link names the run, its loss included; without one the run is the build's, which loses
  // none, whatever the slider kept from an earlier visit. A slider moved before the app arrived is
  // the visitor's, and plays as a press below.
  const linked = readRun(location.hash);
  if (!queued.includes(loss)) showLoss(linked?.loss ?? 0);
  let sim: Sim = fresh(linked?.seed ?? OPENING.seed, (linked?.loss ?? 0) / 100);
  /** What's left of the story the run tells, none once a press has changed the run. */
  let ahead: Action[] = [];
  /** Whether the run is the one the page opened on, with nothing in it that changed it. */
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
      node.setAttribute('data-role', s.role);
      node.setAttribute('data-up', String(s.up));
      $(`[data-rf-node="${s.id}"] [data-rf-dial]`).setAttribute(
        'stroke-dasharray',
        `${timerShare(s, sim.now).toFixed(3)} 1`,
      );
      text($(`[data-rf-node="${s.id}"] [data-rf-role]`), s.up ? s.role : 'down');
      text($(`[data-rf-node="${s.id}"] [data-rf-term]`), `term ${s.term}`);
      const row = $(`[data-rf-log="${s.id}"]`);
      const markup = logMarkup(s);
      if (shownLogs[s.id] !== markup) {
        row.innerHTML = markup;
        row.setAttribute('aria-label', `Server ${s.id + 1}: ${logWords(s)}`);
        row.parentElement?.setAttribute('data-entries', `${s.log.length}`);
        shownLogs[s.id] = markup;
      }
      const toggle = $(`[data-rf-toggle="${s.id}"]`);
      const words = `${s.up ? 'Crash' : 'Restart'} server ${s.id + 1}`;
      text(toggle, words);
      toggle.setAttribute('aria-label', `${words}, now ${serverState(s)}`);
    }
    flights.innerHTML = flightsMarkup(sim, still.matches);
    const fence = cutFence(sim.groups);
    cut.toggleAttribute('data-off', !fence);
    if (fence && cut.getAttribute('d') !== fence) cut.setAttribute('d', fence);
    text($('[data-rf-summary]'), summary(sim));
    // A property breaks at most once in a run, and that stops the run, so this rarely has work.
    const broken = sim.violation?.property;
    if (broken !== shownBroken) {
      shownBroken = broken;
      for (const row of root.querySelectorAll('[data-rf-prop]')) {
        const held = row.getAttribute('data-rf-prop') !== broken;
        row.setAttribute('data-held', String(held));
        text(row.querySelector('[data-rf-prop-word]') as Element, propertyWord(held));
      }
    }
    text($('[data-rf-clock]'), `Virtual time ${seconds(sim.now)}`);
    text($('[data-rf-events]'), eventsWords(sim));
    text($('[data-rf-seed]'), String(sim.seed));
    log.draw(sim.lines);
  }

  const say = speaker(root);

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    run.textContent = 'Run';
    run.setAttribute('data-lamp', 'off');
    draw();
  }

  /** Shows another run from its opening, paused: Start over's, a link's, or the landing run going
   *  round again. */
  function open(next: Sim): void {
    pause();
    sim = next;
    ahead = [];
    log.clear();
    draw();
  }

  function tick(now: number): void {
    if (!playing) return;
    const elapsed = Math.min(FRAME_CAP, now - last);
    last = now;
    playTo(sim, ahead, sim.now + elapsed * speed(), EVENTS_PER_FRAME);
    draw();
    // No run of these servers breaks a property, and if a bug did, its row says so and the run stops.
    if (sim.violation) pause();
    else frame = requestAnimationFrame(tick);
  }

  function play(): void {
    if (sim.violation) return;
    playing = true;
    run.textContent = 'Pause';
    run.setAttribute('data-lamp', 'on');
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

  /** Cuts off the leader and the `more` servers after it, or from server 1 with no leader. */
  const cutOff = (more: number) => {
    const leader = leaderOf(sim)?.id ?? 0;
    split(
      sim,
      sim.servers.map((s) => ((s.id - leader + 5) % 5 <= more ? 1 : 0)),
    );
  };

  /** Starts the story over from where the run stands, its opening. */
  function tell(): void {
    ahead = landingStory();
    told = true;
  }

  function press(control: Element): void {
    const before = sim.lines.at(-1);
    const stepping = control.matches('[data-rf-step]');
    // The story's own actions land in the same list, and Next event can take one: that's no change.
    const actions = stepping ? Infinity : sim.actions.length;
    theirs = true;
    /** What the press says when the log has nothing to tell of it: words that never change stand on
     *  the control, in the page, so a browser never loads them. */
    let why = control.getAttribute('data-why') ?? '';
    const node = control.closest('[data-rf-node], [data-rf-toggle]');
    const id = node?.getAttribute('data-rf-node') ?? node?.getAttribute('data-rf-toggle');
    if (id !== null && id !== undefined) {
      const s = sim.servers[Number(id)] as Server;
      if (s.up) crash(sim, s.id);
      else restart(sim, s.id);
    } else if (control.matches('[data-rf-run]')) {
      if (playing) pause();
      else {
        play();
        // With no story left there may be nothing to watch, and the page says why rather than look
        // stopped. With one ahead the run has something to show, and it asks for nothing.
        say(ahead.length ? '' : why, control);
      }
      return;
    } else if (stepping) {
      if (playing) pause();
      // The next event, or the story's next action when it comes first: a crash is a moment too.
      const story = ahead[0];
      if (story && story.at <= nextTime(sim)) playTo(sim, ahead, story.at);
      else step(sim);
      why = `Virtual time ${seconds(sim.now)}, ${eventsWords(sim)}`;
    } else if (control.matches('[data-rf-write]')) {
      write(sim);
    } else if (control.matches('[data-rf-lone]')) {
      if (leaderOf(sim)) cutOff(0);
    } else if (control.matches('[data-rf-split]')) {
      cutOff(1);
    } else if (control.matches('[data-rf-heal]')) {
      heal(sim);
    } else if (control.matches('[data-rf-reset]')) {
      const wasPlaying = playing;
      open(fresh(sim.seed, lost()));
      if (told) tell();
      // The address names the run, its loss and all, so a reload or the link shared opens it.
      writeLink(linkTo(sim.seed, percent()));
      if (wasPlaying) play();
      say(`${why}${told ? `, before the leader crashes.${watchIt(wasPlaying)}` : '.'}`, control);
      return;
    } else if (control === loss) {
      // Before it changes the loss, the run finishes the events due in this millisecond, as any
      // action does (lib/raft/sim.ts, catchUp), so the page draws what they did.
      setLoss(sim, lost());
      lossOut.textContent = `${loss.value}%`;
      why = `From here, ${percent()}% of messages are lost.`;
    } else return;
    // A press that recorded an action changed the run, and what's left of the story goes. One that
    // found nothing to do, a heal with nothing to heal, recorded none, so it stays.
    if (sim.actions.length > actions) {
      told = false;
      ahead = [];
    }
    const latest = sim.lines.at(-1);
    // A step the log doesn't tell, as most aren't, says where the run stands, so the press is heard.
    say(latest && latest !== before ? latest.text : why, control);
    draw();
  }

  // A label too, though it does nothing here: the speed already chosen fires no input, and it's as
  // much a first press as any (lib/lab/landing-run.ts).
  root.addEventListener('click', (event) => {
    const control = (event.target as Element).closest('button, label, [data-rf-node]');
    if (control) press(control);
  });
  root.addEventListener('input', (event) => press(event.target as Element));
  const moving = { play, pause, playing: () => playing };
  heldByThePage(root, moving, still);
  // A link to another run followed on this page opens that run's opening, paused, as loading it would.
  const writeLink = address(() => {
    const link = readRun(location.hash);
    if (link) {
      theirs = true;
      told = false;
      showLoss(link.loss);
      open(fresh(link.seed, link.loss / 100));
      say(summary(sim));
    }
    return link;
  });

  draw();
  // A link's run has no story. The page's own has it from the start, so Run plays it for a visitor
  // who asked for less motion too, or who pressed before the app arrived.
  if (!linked) tell();
  for (const control of queued) press(control);
  // The run a visitor lands on goes on from the moment the picture tells. A visitor who already
  // pressed something, while the top bar's Pause kept the landing waiting, has their demo already, and
  // nothing here takes it back.
  return () => {
    if (theirs) return;
    runOnLanding(root, {
      ...moving,
      // A run that broke a property stands where it broke, with its row saying so: play() refuses it.
      finished: () => sim.now >= STORY_ENDS,
      again: () => {
        open(fresh(sim.seed, lost()));
        tell();
        play();
      },
    });
  };
}
