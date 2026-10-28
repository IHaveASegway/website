import { check, createChecker, type Checker, type Violation } from './check';
import {
  crash as crashServer,
  createServer,
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

const nodeName = (id: number) => `Node ${id + 1}`;

function say(sim: Sim, text: string): void {
  sim.lines.push({ at: sim.now, text });
  if (sim.lines.length > LINES) sim.lines.splice(0, sim.lines.length - LINES);
}

function noteText(note: Note): string {
  switch (note.kind) {
    case 'election':
      return `${nodeName(note.node)} times out and asks for votes in term ${note.term}`;
    case 'won':
      return `${nodeName(note.node)} wins term ${note.term} with ${note.votes} votes`;
    case 'stepped-down':
      return `${nodeName(note.node)} sees term ${note.term} and becomes a follower`;
    case 'dropped':
      return `${nodeName(note.node)} drops ${note.count} uncommitted ${note.count === 1 ? 'entry' : 'entries'} from index ${note.from}, which the leader's log replaces`;
    case 'committed':
      return `${nodeName(note.node)} commits up to index ${note.index}, an entry of term ${note.term}`;
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

/** Runs every event up to a virtual time, then stands at it. */
export function runUntil(sim: Sim, until: number, limit = Infinity): void {
  let left = limit;
  while (!sim.violation && left-- > 0 && nextTime(sim) <= until) step(sim);
  if (!sim.violation) sim.now = Math.max(sim.now, until);
}

function record(sim: Sim, action: Action): void {
  sim.actions.push(action);
}

export function crash(sim: Sim, node: number): void {
  const s = sim.servers[node];
  if (!s?.up) return;
  record(sim, { at: sim.now, kind: 'crash', node });
  crashServer(s);
  // What it had sent is still on the wire; what was coming to it is lost on arrival.
  say(sim, `${nodeName(node)} crashes. It keeps its term, its vote and its log on disk`);
  settle(sim, []);
}

export function restart(sim: Sim, node: number): void {
  const s = sim.servers[node];
  if (!s || s.up) return;
  record(sim, { at: sim.now, kind: 'restart', node });
  restartServer(s, sim.now, sim.timing, sim.random);
  say(
    sim,
    `${nodeName(node)} restarts as a follower in term ${s.term}, with ${s.log.length} entries`,
  );
  settle(sim, []);
}

/** Cuts the network: each server goes to the side `groups` names for it. */
export function split(sim: Sim, groups: readonly number[]): void {
  record(sim, { at: sim.now, kind: 'split', groups });
  sim.groups = [...groups];
  const sides = [...new Set(groups)].map((g) =>
    groups.flatMap((x, i) => (x === g ? [i + 1] : [])).join(', '),
  );
  say(sim, `The network splits: ${sides.map((s) => `{${s}}`).join(' and ')}`);
  settle(sim, []);
}

export function heal(sim: Sim): void {
  if (sim.groups.every((g) => g === sim.groups[0])) return;
  record(sim, { at: sim.now, kind: 'heal' });
  sim.groups = sim.groups.map(() => 0);
  say(sim, 'The network heals: every node can reach every other');
  settle(sim, []);
}

export function setLoss(sim: Sim, loss: number): void {
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
  say(sim, `${nodeName(s.id)} takes write ${n} at index ${index} in term ${s.term}`);
  settle(sim, []);
  return w;
}

/** Replays recorded actions on a fresh run of the same seed: the run they came from, exactly. */
export function replay(config: Config, actions: readonly Action[], until: number): Sim {
  const sim = createSim(config);
  for (const action of actions) {
    runUntil(sim, action.at);
    if (action.kind === 'crash') crash(sim, action.node);
    else if (action.kind === 'restart') restart(sim, action.node);
    else if (action.kind === 'split') split(sim, action.groups);
    else if (action.kind === 'heal') heal(sim);
    else if (action.kind === 'loss') setLoss(sim, action.loss);
    else write(sim);
  }
  runUntil(sim, until);
  return sim;
}

/** The leader now, if one server leads the highest term any server holds. */
export function leaderOf(sim: Sim): Server | null {
  const up = sim.servers.filter((s) => s.up);
  const top = Math.max(0, ...up.map((s) => s.term));
  return up.find((s) => s.role === 'leader' && s.term === top) ?? null;
}

export type { Violation };
