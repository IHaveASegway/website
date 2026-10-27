import {
  crash,
  heal,
  leaderOf,
  replay,
  restart,
  runUntil,
  setLoss,
  split,
  step,
  write,
  type Line,
  type Sim,
} from '../../lib/raft/sim';
import {
  cutLine,
  flightsMarkup,
  logMarkup,
  logWords,
  nodeText,
  OPENING,
  ROLE_WORD,
  seconds,
  statusText,
  summary,
  timerShare,
} from '../../lib/raft/view';

// The Raft Lab in the browser (ADR 0020): the simulation, run in virtual time and drawn on every
// frame while it runs. It opens paused, on the same opening the build drew, and moves only when
// the visitor presses Run, which Pause stops (SC 2.2.2); a hidden tab pauses it too. With reduced
// motion, messages do not glide: each one stands half way along its path, and Run advances in
// steps of 50 virtual milliseconds twice a second.

const FRAME_CAP = 100; // real ms: a frame after a long pause does not leap ahead
const EVENTS_PER_FRAME = 4_000;
const STILL_STEP = 50; // virtual ms per step under reduced motion
const STILL_EVERY = 500; // real ms between those steps

const seedFromHash = (): number | null => {
  const match = /^#seed-(\d{1,6})$/.exec(location.hash);
  return match ? Number(match[1]) : null;
};

export function start(root: HTMLElement, queued: readonly Element[]): void {
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const map = $<SVGSVGElement>('[data-rf-map]');
  const flights = $<SVGGElement>('[data-rf-flights]');
  const cut = $<SVGLineElement>('[data-rf-cut]');
  const run = $<HTMLButtonElement>('[data-rf-run]');
  const loss = $<HTMLInputElement>('[data-rf-loss]');
  const lossOut = $<HTMLOutputElement>('[data-rf-loss-out]');
  const speed = $<HTMLSelectElement>('[data-rf-speed]');
  const lines = $<HTMLOListElement>('[data-rf-lines]');
  const said = $('[data-rf-said]');
  const text = (selector: string, value: string) => {
    const element = $(selector);
    if (element && element.textContent !== value) element.textContent = value;
  };

  let sim: Sim = fresh(seedFromHash() ?? OPENING.seed);
  let playing = false;
  let last = 0;
  let frame = 0;
  let timer = 0;
  let shownLines: Line | undefined;
  const shownLogs: string[] = [];

  function fresh(seed: number): Sim {
    const next = replay({ seed }, OPENING.actions, OPENING.until);
    next.loss = Number(loss?.value ?? 0) / 100;
    return next;
  }

  /** Everything the page shows of the run, changed only where it changed. */
  function draw(): void {
    for (const s of sim.servers) {
      const node = map?.querySelector(`[data-rf-node="${s.id}"]`);
      if (node) {
        node.setAttribute('data-role', s.role);
        node.setAttribute('data-up', String(s.up));
        const dial = node.querySelector('[data-rf-dial]');
        dial?.setAttribute('stroke-dasharray', `${timerShare(s, sim.now).toFixed(3)} 1`);
        const role = node.querySelector('[data-rf-role]');
        const label = s.up ? ROLE_WORD[s.role] : 'down';
        if (role && role.textContent !== label) role.textContent = label;
        const term = node.querySelector('[data-rf-term]');
        if (term && term.textContent !== `term ${s.term}`) term.textContent = `term ${s.term}`;
      }
      const log = root.querySelector(`[data-rf-log="${s.id}"]`);
      const markup = logMarkup(s);
      if (log && shownLogs[s.id] !== markup) {
        log.innerHTML = markup;
        log.setAttribute('aria-label', `Node ${s.id + 1}: ${logWords(s)}`);
        shownLogs[s.id] = markup;
      }
      const toggle = root.querySelector(`[data-rf-toggle="${s.id}"]`);
      if (toggle) {
        const verb = s.up ? 'Crash' : 'Restart';
        const words = `${verb} node ${s.id + 1}`;
        if (toggle.textContent !== words) toggle.textContent = words;
        const state = nodeText(s).split(', ').slice(1).join(', ');
        toggle.setAttribute('aria-label', `${words}, now ${state}`);
      }
    }
    if (flights) flights.innerHTML = flightsMarkup(sim, still.matches);
    const chord = cutLine(sim.groups);
    if (cut) {
      if (chord) {
        cut.removeAttribute('data-off');
        for (const [key, value] of Object.entries(chord)) cut.setAttribute(key, String(value));
      } else cut.setAttribute('data-off', '');
    }
    text('[data-rf-summary]', summary(sim));
    text('[data-rf-status]', statusText(sim));
    text('[data-rf-clock]', `Virtual time ${seconds(sim.now)}`);
    text('[data-rf-seed]', String(sim.seed));
    drawLines();
  }

  /** The event log: new lines appended, the oldest dropped past 60. */
  function drawLines(): void {
    if (!lines) return;
    const from = shownLines ? sim.lines.indexOf(shownLines) + 1 : 0;
    if (shownLines && from === 0) lines.replaceChildren();
    const start = from === 0 ? Math.max(0, sim.lines.length - 60) : from;
    for (const line of sim.lines.slice(start)) {
      const item = document.createElement('li');
      const at = document.createElement('span');
      at.className = 'rf-at';
      at.textContent = seconds(line.at);
      item.append(at, ` ${line.text}`);
      lines.append(item);
    }
    while (lines.children.length > 60) lines.firstElementChild?.remove();
    const box = lines.parentElement;
    if (box && sim.lines.length > start) box.scrollTop = box.scrollHeight;
    shownLines = sim.lines.at(-1);
  }

  const say = (words: string) => {
    if (said) said.textContent = words;
  };

  function pause(): void {
    playing = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    if (run) run.textContent = 'Run';
    run?.setAttribute('aria-pressed', 'false');
    draw();
  }

  function tick(now: number): void {
    if (!playing) return;
    const elapsed = Math.min(FRAME_CAP, now - last);
    last = now;
    runUntil(sim, sim.now + elapsed * Number(speed?.value ?? 0.05), EVENTS_PER_FRAME);
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
    run?.setAttribute('aria-pressed', 'true');
    if (still.matches) {
      timer = window.setInterval(() => {
        runUntil(sim, sim.now + STILL_STEP, EVENTS_PER_FRAME);
        draw();
        if (sim.violation) pause();
      }, STILL_EVERY);
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** A side of two: the leader and the node after it, or nodes 1 and 2 with no leader. */
  function twoAndThree(): number[] {
    const leader = leaderOf(sim)?.id ?? 0;
    const size = sim.servers.length;
    return sim.servers.map((s) => (s.id === leader || s.id === (leader + 1) % size ? 1 : 0));
  }

  function press(control: Element): void {
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
    } else if (control.matches('[data-rf-reset]')) {
      const wasPlaying = playing;
      pause();
      sim = fresh(sim.seed + 1);
      shownLines = undefined;
      lines?.replaceChildren();
      history.replaceState(null, '', `#seed-${sim.seed}`);
      if (wasPlaying) play();
    } else if (control.matches('[data-rf-loss]') && loss) {
      setLoss(sim, Number(loss.value) / 100);
      if (lossOut) lossOut.textContent = `${loss.value}%`;
      return;
    } else if (control.matches('[data-rf-speed]')) {
      return;
    } else return;
    const latest = sim.lines.at(-1);
    if (latest && latest !== shownLines) say(latest.text);
    draw();
  }

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button, [data-rf-node]');
    if (control) press(control);
  });
  root.addEventListener('input', (event) => {
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

  if (seedFromHash() !== null) draw();
  for (const control of queued) press(control);
}
