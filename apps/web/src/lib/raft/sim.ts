import { check, createChecker, type Checker, type Violation } from './check';
import {
  crash as crashServer,
  createServer,
  majority,
  propose,
  receive,
  restart as restartServer,
  tick,
  TIMING,
  type Faults,
  type Message,
  type Note,
  type Server,
  type Timing,
} from './core';

// A deterministic simulation of a Raft cluster (ADR 0020), in the style FoundationDB made known:
// virtual time, one seeded random stream for every choice the network and the timers make, and
// the visitor's actions recorded at the virtual time they happened. The same seed and the same
// actions give the same run, event for event, in a test, at build and in the browser.

/** mulberry32: a small, fast seeded generator, plenty for timeouts and latencies. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A message on the wire: sent, and due to arrive, or to vanish half way if the network loses it. */
export interface Flight {
  readonly id: number;
  readonly message: Message;
  readonly sent: number;
  readonly arrives: number;
  readonly lost: boolean;
}

export type Action =
  | { readonly at: number; readonly kind: 'crash' | 'restart'; readonly node: number }
  | { readonly at: number; readonly kind: 'split'; readonly groups: readonly number[] }
  | { readonly at: number; readonly kind: 'heal' | 'write' }
  | { readonly at: number; readonly kind: 'loss'; readonly loss: number };

/** A client write: which server took it, where in its log, and what became of it. */
export interface Write {
  readonly n: number;
  readonly at: number;
  readonly node: number;
  readonly index: number;
  readonly term: number;
  state: 'pending' | 'committed' | 'lost';
}

export interface Line {
  readonly at: number;
  readonly text: string;
}

export interface Config {
  readonly seed: number;
  readonly size?: number;
  readonly timing?: Timing;
  /** One-way latency, in virtual milliseconds. */
  readonly latency?: readonly [number, number];
  readonly loss?: number;
  readonly faults?: Faults;
}

export interface Sim {
  readonly seed: number;
  readonly timing: Timing;
  readonly latency: readonly [number, number];
  readonly faults: Faults;
  readonly random: () => number;
  readonly servers: Server[];
  readonly checker: Checker;
  now: number;
  loss: number;
  /** Each server's side of the network; servers on different sides cannot reach each other. */
  groups: number[];
  flights: Flight[];
  nextFlight: number;
  writes: Write[];
  /** The server the client sends its writes to: the one that took its last write. */
  target: number | null;
  events: number;
  lines: Line[];
  readonly actions: Action[];
  violation: Violation | null;
}

const LINES = 200;

export function createSim(config: Config): Sim {
  const size = config.size ?? 5;
  const timing = config.timing ?? TIMING;
  const random = seeded(config.seed);
  return {
    seed: config.seed,
    timing,
    latency: config.latency ?? [12, 40],
    faults: config.faults ?? {},
    random,
    servers: Array.from({ length: size }, (_, id) => createServer(id, size, 0, timing, random)),
    checker: createChecker(),
    now: 0,
    loss: config.loss ?? 0,
    groups: Array.from({ length: size }, () => 0),
    flights: [],
    nextFlight: 0,
    writes: [],
    target: null,
    events: 0,
    lines: [],
    actions: [],
    violation: null,
  };
}

const serverName = (id: number) => `Server ${id + 1}`;

function say(sim: Sim, text: string): void {
  sim.lines.push({ at: sim.now, text });
  if (sim.lines.length > LINES) sim.lines.splice(0, sim.lines.length - LINES);
}

function noteText(note: Note): string {
  switch (note.kind) {
    case 'election':
      return `${serverName(note.node)} times out and asks for votes in term ${note.term}`;
    case 'won':
      return `${serverName(note.node)} wins term ${note.term} with ${note.votes} votes`;
    case 'stepped-down':
      return `${serverName(note.node)} sees term ${note.term} and becomes a follower`;
    case 'dropped':
      return `${serverName(note.node)} drops ${note.count} uncommitted ${note.count === 1 ? 'entry' : 'entries'} from index ${note.from}, which the leader's log replaces`;
    case 'committed':
      return `${serverName(note.node)} commits up to index ${note.index}, an entry of term ${note.term}`;
  }
}

const reachable = (sim: Sim, a: number, b: number) => sim.groups[a] === sim.groups[b];

function send(sim: Sim, messages: readonly Message[]): void {
  for (const message of messages) {
    if (!reachable(sim, message.from, message.to)) continue;
    const [low, high] = sim.latency;
    const delay = low + Math.floor(sim.random() * (high - low));
    const lost = sim.random() < sim.loss;
    sim.flights.push({
      id: sim.nextFlight++,
      message,
      sent: sim.now,
      arrives: sim.now + delay,
      lost,
    });
  }
}

/** After every event: what a write became, and whether a safety property broke. A write is lost
 *  only once its index is committed with another entry: until then a later leader may still
 *  carry it to a majority. */
function settle(sim: Sim, notes: readonly Note[]): void {
  for (const note of notes) say(sim, noteText(note));
  for (const write of sim.writes) {
    if (write.state !== 'pending') continue;
    const committed = sim.checker.committed[write.index];
    if (!committed) continue;
    if (committed.term === write.term && committed.write === write.n) {
      write.state = 'committed';
      say(sim, `Write ${write.n} is committed at index ${write.index}: it can never be lost`);
    } else {
      write.state = 'lost';
      say(
        sim,
        `Write ${write.n} is gone: it was never committed, and index ${write.index} is committed with another entry`,
      );
    }
  }
  sim.violation ??= check(sim.checker, sim.servers, sim.now);
}

/** When the next event happens: a message arriving or a server's timer, whichever is first. */
export function nextTime(sim: Sim): number {
  let next = Infinity;
  for (const f of sim.flights) if (f.arrives < next) next = f.arrives;
  for (const s of sim.servers) if (s.up && s.deadline < next) next = s.deadline;
  return next;
}

/** Processes the next event, in a fixed order: messages before timers, each by id. */
export function step(sim: Sim): boolean {
  if (sim.violation) return false;
  const at = nextTime(sim);
  if (!Number.isFinite(at)) return false;
  sim.now = Math.max(sim.now, at);
  const notes: Note[] = [];
  let index = -1;
  for (let i = 0; i < sim.flights.length; i++) {
    const f = sim.flights[i] as Flight;
    if (f.arrives === at && (index < 0 || f.id < (sim.flights[index] as Flight).id)) index = i;
  }
  if (index >= 0) {
    const [f] = sim.flights.splice(index, 1) as [Flight];
    const to = sim.servers[f.message.to] as Server;
    if (!f.lost && to.up && reachable(sim, f.message.from, f.message.to)) {
      send(sim, receive(to, f.message, sim.now, sim.timing, sim.random, notes, sim.faults));
    }
  } else {
    const s = sim.servers.find((x) => x.up && x.deadline === at) as Server;
    send(sim, tick(s, sim.now, sim.timing, sim.random, notes));
  }
  sim.events += 1;
  settle(sim, notes);
  return true;
}

/**
 * Runs every event up to a virtual time, then stands at it. With a `limit`, as a page's frame runs
 * it, it stops once that many events have run and the moment they reached is over: the run then
 * stands at the last event it ran, and the clock goes no further than the work done. Moving the
 * clock on past events not yet run would run them late, each reply sent and each timer set from a
 * later time than in the run replay() rebuilds, and an action taken meanwhile would come before
 * them in the run and after them in its replay. Stopping only between two moments, never between
 * two events of one, leaves every event at or before the time the run stands at already run.
 */
export function runUntil(sim: Sim, until: number, limit = Infinity): void {
  let left = limit;
  while (!sim.violation && nextTime(sim) <= until) {
    if (left <= 0 && nextTime(sim) > sim.now) return;
    step(sim);
    left -= 1;
  }
  if (!sim.violation) sim.now = Math.max(sim.now, until);
}

/** Every action takes effect at the end of its millisecond, after the events still due in it,
 *  before it even checks whether it applies. An action records only its time, and replay runs
 *  every event up to that time before it acts, so this is the one place replay can put it. A run
 *  driven event by event, by step() as the page's Next event button drives it, could otherwise act
 *  between two events of one millisecond, and its replay would differ. Events in one millisecond
 *  happen at the same time, so an action that lands after them all still lands at the time it was
 *  taken. */
function catchUp(sim: Sim): void {
  runUntil(sim, sim.now);
}

function record(sim: Sim, action: Action): void {
  sim.actions.push(action);
}

export function crash(sim: Sim, node: number): void {
  catchUp(sim);
  const s = sim.servers[node];
  if (!s?.up) return;
  record(sim, { at: sim.now, kind: 'crash', node });
  crashServer(s);
  // What it had sent is still on the wire; what was coming to it is lost on arrival.
  say(sim, `${serverName(node)} crashes. It keeps its term, its vote and its log on disk`);
  settle(sim, []);
}

export function restart(sim: Sim, node: number): void {
  catchUp(sim);
  const s = sim.servers[node];
  if (!s || s.up) return;
  record(sim, { at: sim.now, kind: 'restart', node });
  restartServer(s, sim.now, sim.timing, sim.random);
  say(
    sim,
    `${serverName(node)} restarts as a follower in term ${s.term}, with ${s.log.length} entries`,
  );
  settle(sim, []);
}

/** Cuts the network: each server goes to the side `groups` names for it. */
export function split(sim: Sim, groups: readonly number[]): void {
  catchUp(sim);
  record(sim, { at: sim.now, kind: 'split', groups });
  sim.groups = [...groups];
  const sides = [...new Set(groups)].map((g) =>
    groups.flatMap((x, i) => (x === g ? [i + 1] : [])).join(', '),
  );
  say(sim, `The network splits: ${sides.map((s) => `{${s}}`).join(' and ')}`);
  settle(sim, []);
}

export function heal(sim: Sim): void {
  catchUp(sim);
  if (sim.groups.every((g) => g === sim.groups[0])) return;
  record(sim, { at: sim.now, kind: 'heal' });
  sim.groups = sim.groups.map(() => 0);
  say(sim, 'The network heals: every server can reach every other');
  settle(sim, []);
}

export function setLoss(sim: Sim, loss: number): void {
  catchUp(sim);
  record(sim, { at: sim.now, kind: 'loss', loss });
  sim.loss = loss;
}

/** The server a client would send a write to: the last one that took a write while it still
 *  thinks it leads, or else the leader of the highest term. A client cannot see a partition. */
export function writeTarget(sim: Sim): Server | null {
  const lastUsed = sim.target === null ? null : sim.servers[sim.target];
  if (lastUsed?.up && lastUsed.role === 'leader') return lastUsed;
  const leaders = sim.servers.filter((s) => s.up && s.role === 'leader');
  leaders.sort((a, b) => b.term - a.term || a.id - b.id);
  return leaders[0] ?? null;
}

export function write(sim: Sim): Write | null {
  catchUp(sim);
  record(sim, { at: sim.now, kind: 'write' });
  const n = sim.writes.length + 1;
  const s = writeTarget(sim);
  const index = s ? propose(s, n) : null;
  if (!s || index === null) {
    say(sim, `Write ${n} finds no leader to take it, so nothing is written`);
    sim.writes.push({ n, at: sim.now, node: -1, index: 0, term: 0, state: 'lost' });
    return null;
  }
  sim.target = s.id;
  const w: Write = { n, at: sim.now, node: s.id, index, term: s.term, state: 'pending' };
  sim.writes.push(w);
  say(sim, `${serverName(s.id)} takes write ${n} at index ${index} in term ${s.term}`);
  settle(sim, []);
  return w;
}

/** Takes one recorded action, as the press that made it did. */
function act(sim: Sim, action: Action): void {
  if (action.kind === 'crash') crash(sim, action.node);
  else if (action.kind === 'restart') restart(sim, action.node);
  else if (action.kind === 'split') split(sim, action.groups);
  else if (action.kind === 'heal') heal(sim);
  else if (action.kind === 'loss') setLoss(sim, action.loss);
  else write(sim);
}

/** Replays recorded actions on a fresh run of the same seed: the run they came from, exactly. */
export function replay(config: Config, actions: readonly Action[], until: number): Sim {
  const sim = createSim(config);
  for (const action of actions) {
    runUntil(sim, action.at);
    act(sim, action);
  }
  runUntil(sim, until);
  return sim;
}

/**
 * Runs a run on to `until`, taking each action still `ahead` at its moment: every event up to that
 * time first, then the action, as replay does, so a script played a frame at a time is the run its
 * actions replay. Within `limit` events for each stretch, as a frame's budget; when the budget runs
 * out first, the run stands where it got to and the action waits for the next frame. Takes what it
 * plays off `ahead`.
 */
export function playTo(sim: Sim, ahead: Action[], until: number, limit = Infinity): void {
  for (let next = ahead[0]; next && next.at <= until; next = ahead[0]) {
    runUntil(sim, next.at, limit);
    if (sim.violation || sim.now < next.at) return;
    ahead.shift();
    act(sim, next);
  }
  runUntil(sim, until, limit);
}

/** The side of the network that can elect a leader and commit: one with a majority of the cluster
 *  up. There is at most one, and none when crashes and cuts leave every side short. */
const electingSide = (sim: Sim): number | undefined =>
  sim.groups.find(
    (group) =>
      sim.servers.filter((s) => s.up && sim.groups[s.id] === group).length >=
      majority(sim.servers.length),
  );

/** The term the cluster is in: the highest on the side that can elect, or anywhere when no side
 *  can. A server cut off from a majority keeps timing out and its term climbs, but nobody it can
 *  reach can vote it in, so that climbing number says nothing about the cluster. */
export function currentTerm(sim: Sim): number {
  const side = electingSide(sim);
  return Math.max(
    0,
    ...sim.servers.flatMap((s) =>
      s.up && (side === undefined || sim.groups[s.id] === side) ? [s.term] : [],
    ),
  );
}

/** Who leads, and who only thinks so. A leader is overtaken once a higher term reaches it or a
 *  majority has moved on without it: until then it's the leader, cut off or not, and it stays one
 *  beside a lone server whose term has climbed past its own, committing writes all the while. Every
 *  other leader that's up is behind, and will think it leads until it hears otherwise, which a leader
 *  cut off from the rest can't. */
export function leaders(sim: Sim): { leader: Server | null; behind: Server[] } {
  const side = electingSide(sim);
  const up = sim.servers.filter((s) => s.up);
  const all = up.filter((s) => s.role === 'leader');
  const [leader = null] = all
    .filter(
      (s) =>
        !up.some(
          (x) =>
            x.term > s.term && (sim.groups[x.id] === sim.groups[s.id] || sim.groups[x.id] === side),
        ),
    )
    .sort((a, b) => b.term - a.term);
  return { leader, behind: all.filter((s) => s !== leader) };
}

/** The leader now, if there is one. */
export const leaderOf = (sim: Sim): Server | null => leaders(sim).leader;

/** How many entries are committed: the highest index any server ever committed, a high-water mark.
 *  Each server's own commit index is volatile (Raft paper, Figure 2), so it falls to 0 in a crash,
 *  and with all five down no server knows any. What a majority holds is still committed, and the
 *  checker keeps what each committed index holds (1-based, so its length is one past the last). */
export const committedCount = (sim: Sim): number => Math.max(0, sim.checker.committed.length - 1);

export type { Violation };
