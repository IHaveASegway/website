import { describe, expect, test } from 'vitest';
import { fresh } from '../src/components/raft-lab/app';
import { check, createChecker } from '../src/lib/raft/check';
import {
  createServer,
  crash as crashServer,
  propose,
  receive,
  tick,
  TIMING,
  type Faults,
  type Message,
  type Note,
  type Server,
} from '../src/lib/raft/core';
import {
  crash,
  createSim,
  heal,
  leaderOf,
  nextTime,
  replay,
  restart,
  runUntil,
  seeded,
  setLoss,
  split,
  step,
  write,
  type Action,
  type Flight,
  type Sim,
} from '../src/lib/raft/sim';
import {
  cutFence,
  footprint,
  linkTo,
  LOSSES,
  nextSeed,
  OPENING,
  openingRun,
  readRun,
  SEEDS_IN_CI,
  SIZE,
} from '../src/lib/raft/view';

// The Raft Lab's core (ADR 0020): known answers for each of Figure 2's rules, then a property
// sweep. The sweep runs many seeded runs with crashes, partitions and loss, checks the five safety
// properties after every event, and requires a committed write soon after the network heals. Two
// deliberately broken servers show the sweep can find a real bug: each must break a property.

const notes: Note[] = [];
const fixed = () => 0.5;
const server = (id: number, size = 5) => createServer(id, size, 0, TIMING, fixed);
const at = (s: Server, m: Message, faults?: Faults) =>
  receive(s, m, 0, TIMING, fixed, notes, faults);

describe('RequestVote', () => {
  test('grants one vote a term, to a candidate whose log is at least as up to date', () => {
    const s = server(0);
    const ask = (from: number, term: number, lastIndex = 0, lastTerm = 0): Message => ({
      kind: 'vote',
      term,
      from,
      to: 0,
      lastIndex,
      lastTerm,
    });
    expect(at(s, ask(1, 1))).toEqual([{ kind: 'voted', term: 1, from: 0, to: 1, granted: true }]);
    expect(s.votedFor).toBe(1);
    // Another candidate in the same term: refused. The same one again: granted again.
    expect((at(s, ask(2, 1))[0] as { granted: boolean }).granted).toBe(false);
    expect((at(s, ask(1, 1))[0] as { granted: boolean }).granted).toBe(true);
    // A higher term clears the vote.
    expect((at(s, ask(2, 2))[0] as { granted: boolean }).granted).toBe(true);
    expect(s.term).toBe(2);
  });

  test('refuses a candidate whose last entry is of an older term, or a shorter log of the same term', () => {
    const s = server(0);
    s.term = 3;
    s.log = [
      { term: 1, write: 1 },
      { term: 3, write: 2 },
    ];
    s.hashes = [];
    const ask = (lastIndex: number, lastTerm: number): Message => ({
      kind: 'vote',
      term: 4,
      from: 1,
      to: 0,
      lastIndex,
      lastTerm,
    });
    const granted = (m: Message, faults?: Faults) => {
      const fresh = server(0);
      Object.assign(fresh, { term: 3, log: s.log });
      return (at(fresh, m, faults)[0] as { granted: boolean }).granted;
    };
    expect(granted(ask(5, 2))).toBe(false); // longer, but an older last term
    expect(granted(ask(1, 3))).toBe(false); // same last term, shorter
    expect(granted(ask(2, 3))).toBe(true);
    expect(granted(ask(1, 4))).toBe(true); // a newer last term wins, whatever the length
    // The broken server votes for anyone: the bug the sweep must find.
    expect(granted(ask(5, 2), { anyLogVotes: true })).toBe(true);
  });

  test('a stale candidate is told the newer term and refused', () => {
    const s = server(0);
    s.term = 5;
    expect(at(s, { kind: 'vote', term: 4, from: 1, to: 0, lastIndex: 0, lastTerm: 0 })).toEqual([
      { kind: 'voted', term: 5, from: 0, to: 1, granted: false },
    ]);
  });
});

describe('elections', () => {
  test('a timed-out follower becomes a candidate, votes for itself and asks every peer', () => {
    const s = server(2);
    const out = tick(s, s.deadline, TIMING, fixed, notes);
    expect(s.role).toBe('candidate');
    expect(s.term).toBe(1);
    expect(s.votedFor).toBe(2);
    expect(out.map((m) => m.to)).toEqual([0, 1, 3, 4]);
    expect(out.every((m) => m.kind === 'vote' && m.term === 1)).toBe(true);
  });

  test('a majority of votes makes it leader, which sends AppendEntries at once', () => {
    const s = server(0);
    tick(s, s.deadline, TIMING, fixed, notes);
    const vote = (from: number): Message => ({
      kind: 'voted',
      term: 1,
      from,
      to: 0,
      granted: true,
    });
    expect(at(s, vote(1))).toEqual([]);
    const out = at(s, vote(2));
    expect(s.role).toBe('leader');
    expect(out.map((m) => m.kind)).toEqual(['append', 'append', 'append', 'append']);
  });
});

describe('AppendEntries', () => {
  const append = (over: Partial<Extract<Message, { kind: 'append' }>>): Message => ({
    kind: 'append',
    term: 1,
    from: 1,
    to: 0,
    prevIndex: 0,
    prevTerm: 0,
    entries: [],
    leaderCommit: 0,
    ...over,
  });

  test('refuses an older term, and a log without the entry at prevIndex', () => {
    const s = server(0);
    s.term = 2;
    expect((at(s, append({ term: 1 }))[0] as { success: boolean }).success).toBe(false);
    const short = at(s, append({ term: 2, prevIndex: 3, prevTerm: 2 }))[0];
    expect(short).toMatchObject({ success: false, index: 1 }); // try from this log's end
  });

  test('appends, cuts a conflicting suffix only, and commits only what the message proves', () => {
    const s = server(0);
    at(
      s,
      append({
        entries: [
          { term: 1, write: 1 },
          { term: 1, write: 2 },
          { term: 1, write: 3 },
        ],
      }),
    );
    expect(s.log.map((e) => e.write)).toEqual([1, 2, 3]);
    // A late copy of the first message changes nothing: no conflict, no cut.
    at(s, append({ entries: [{ term: 1, write: 1 }] }));
    expect(s.log).toHaveLength(3);
    // A new leader of term 2 disagrees from index 2: index 2 and 3 go, its entry follows.
    const out = at(
      s,
      append({
        term: 2,
        from: 2,
        prevIndex: 1,
        prevTerm: 1,
        entries: [{ term: 2, write: 9 }],
        leaderCommit: 3,
      }),
    );
    expect(s.log.map((e) => e.write)).toEqual([1, 9]);
    expect(out[0]).toMatchObject({ success: true, index: 2 });
    // Its commit index is 3, but this message proves the logs match only to 2.
    expect(s.commitIndex).toBe(2);
    expect(s.applied).toEqual([1, 9]);
    // A heartbeat that proves less never moves the commit index back.
    at(s, append({ term: 2, from: 2, prevIndex: 0, leaderCommit: 3 }));
    expect(s.commitIndex).toBe(2);
  });

  test('a candidate that hears from a leader of its term steps down', () => {
    const s = server(0);
    tick(s, s.deadline, TIMING, fixed, notes);
    expect(s.role).toBe('candidate');
    at(s, append({ term: 1 }));
    expect(s.role).toBe('follower');
    expect(s.leader).toBe(1);
  });
});

describe('commit rule', () => {
  function leaderWith(log: { term: number; write: number }[], term: number) {
    const s = server(0);
    s.term = term;
    s.role = 'leader';
    s.log = log;
    s.hashes = [];
    s.matchIndex = [log.length, 0, 0, 0, 0];
    s.nextIndex = [0, 1, 1, 1, 1];
    return s;
  }
  const reply = (from: number, index: number, term: number): Message => ({
    kind: 'appended',
    term,
    from,
    to: 0,
    success: true,
    index,
  });

  test('commits an entry of its own term once a majority holds it', () => {
    const s = leaderWith([{ term: 2, write: 1 }], 2);
    at(s, reply(1, 1, 2));
    expect(s.commitIndex).toBe(0);
    at(s, reply(2, 1, 2));
    expect(s.commitIndex).toBe(1);
  });

  test("Figure 8: never commits an older term's entry by counting replicas, unless broken", () => {
    const safe = leaderWith([{ term: 2, write: 1 }], 4);
    at(safe, reply(1, 1, 4));
    at(safe, reply(2, 1, 4));
    expect(safe.commitIndex).toBe(0);
    const broken = leaderWith([{ term: 2, write: 1 }], 4);
    const faults = { oldTermCommits: true };
    at(broken, reply(1, 1, 4), faults);
    at(broken, reply(2, 1, 4), faults);
    expect(broken.commitIndex).toBe(1);
  });
});

test('a crash keeps the term, the vote and the log, and loses everything else', () => {
  const s = server(0);
  s.term = 3;
  s.votedFor = 2;
  s.role = 'leader';
  propose(s, 7);
  s.commitIndex = 1;
  s.applied = [7];
  crashServer(s);
  expect({ term: s.term, votedFor: s.votedFor, log: s.log }).toEqual({
    term: 3,
    votedFor: 2,
    log: [{ term: 3, write: 7 }],
  });
  expect({ role: s.role, commitIndex: s.commitIndex, applied: s.applied }).toEqual({
    role: 'follower',
    commitIndex: 0,
    applied: [],
  });
});

describe('the checker', () => {
  test('known answers: two leaders in one term, and two different commits at one index', () => {
    const a = server(0);
    const b = server(1);
    a.role = b.role = 'leader';
    a.term = b.term = 1;
    expect(check(createChecker(), [a, b], 0)?.property).toBe('Election Safety');

    const x = server(0);
    const y = server(1);
    x.term = y.term = 1;
    x.role = 'leader';
    x.log.push({ term: 1, write: 1 });
    y.log.push({ term: 1, write: 2 });
    x.hashes = [x.hashes[0] as number, 1];
    y.hashes = [y.hashes[0] as number, 2];
    x.commitIndex = y.commitIndex = 1;
    x.applied = [1];
    y.applied = [2];
    expect(check(createChecker(), [x, y], 0)?.property).toBe('Log Matching');
  });
});

/** A seeded run with faults: actions every 150–500 ms for 8 s, then the network heals, every
 *  server restarts, and a client writes every 250 ms until one write commits. */
function faultyRun(seed: number, faults: Faults = {}) {
  const sim = createSim({ seed, faults });
  const pick = seeded(seed * 7919 + 17);
  const size = sim.servers.length;
  let t = 0;
  while (t < 8_000 && !sim.violation) {
    t += 150 + Math.floor(pick() * 350);
    runUntil(sim, t);
    if (sim.violation) break;
    const roll = pick();
    const node = Math.floor(pick() * size);
    if (roll < 0.35) write(sim);
    else if (roll < 0.55) crash(sim, node);
    else if (roll < 0.75) restart(sim, node);
    else if (roll < 0.87)
      split(
        sim,
        sim.servers.map(() => (pick() < 0.5 ? 0 : 1)),
      );
    else if (roll < 0.95) heal(sim);
    else setLoss(sim, Math.floor(pick() * 30) / 100);
  }
  // The last action may land after 8 s: the network heals once it is done.
  runUntil(sim, 8_000);
  const healed = sim.now;
  if (!sim.violation) {
    heal(sim);
    setLoss(sim, 0);
    for (let i = 0; i < size; i++) restart(sim, i);
  }
  let committedAt: number | null = null;
  for (let at = healed + 500; at <= healed + 2_500 && !sim.violation; at += 250) {
    runUntil(sim, at);
    if (sim.writes.some((w) => w.state === 'committed' && w.at >= healed)) {
      committedAt ??= at;
      break;
    }
    write(sim);
  }
  if (committedAt === null && !sim.violation) {
    runUntil(sim, healed + 2_750);
    if (sim.writes.some((w) => w.state === 'committed' && w.at >= healed))
      committedAt = healed + 2_750;
  }
  return { sim, committedAt };
}

/** How many seeds the sweep runs: about 1.5 s of the suite on a laptop. */
const SEEDS = SEEDS_IN_CI;

// The work is fixed, but the wall clock is not: on a CI runner, beside the other test files, the
// full sweep took 3.7 s on a pull request and 5.2 s on main, past vitest's 5 s default
// (2026-10-28). The limit only catches a hang; a server that stops being caught fails its assertion.
describe('the property sweep', { timeout: 30_000 }, () => {
  test(`${SEEDS} faulty runs: every safety property holds after every event, and a write commits within 2.75 s of healing`, () => {
    const broken: string[] = [];
    let events = 0;
    let lostWrites = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { sim, committedAt } = faultyRun(seed);
      events += sim.events;
      lostWrites += sim.writes.filter((w) => w.state === 'lost').length;
      if (sim.violation)
        broken.push(`seed ${seed}: ${sim.violation.property}: ${sim.violation.detail}`);
      else if (committedAt === null) broken.push(`seed ${seed}: no committed write after healing`);
    }
    expect(broken).toEqual([]);
    // The sweep did real work: elections, losses and plenty of events.
    expect(events).toBeGreaterThan(SEEDS * 500);
    expect(lostWrites).toBeGreaterThan(0);
  });

  test.each([
    ['votes without the up-to-date check', { anyLogVotes: true }],
    ["commits an older term's entry by counting replicas (Figure 8)", { oldTermCommits: true }],
  ] as const)('a server that %s is caught within the sweep', (_name, faults) => {
    let caught: string | null = null;
    for (let seed = 1; seed <= SEEDS && !caught; seed++) {
      const { sim } = faultyRun(seed, faults);
      if (sim.violation) caught = `seed ${seed}: ${sim.violation.property}`;
    }
    expect(caught).not.toBeNull();
  });
});

test('determinism: the same seed and actions give the same run, event for event', () => {
  const run = () => {
    const sim = createSim({ seed: 42 });
    runUntil(sim, 600);
    write(sim);
    runUntil(sim, 900);
    crash(sim, leaderOf(sim)?.id ?? 0);
    runUntil(sim, 1_600);
    write(sim);
    runUntil(sim, 2_000);
    return sim;
  };
  const a = run();
  const b = run();
  const again = replay({ seed: 42 }, a.actions, 2_000);
  const shape = (s: Sim) =>
    JSON.stringify([s.events, s.servers.map((x) => [x.term, x.role, x.log]), s.lines]);
  expect(shape(b)).toBe(shape(a));
  expect(shape(again)).toBe(shape(a));
});

/** A run's whole state, part by part: two runs are one run when no part differs. */
const parts = (s: Sim) => ({
  clock: s.now,
  events: s.events,
  servers: s.servers.map((x) => ({ ...x, votes: [...x.votes] })),
  wire: [s.flights, s.nextFlight],
  network: [s.groups, s.loss],
  writes: [s.writes, s.target],
  checker: [
    [...s.checker.leaders],
    s.checker.committed,
    [...s.checker.leaderLogs],
    s.checker.checkedApplied,
  ],
  lines: s.lines,
  actions: s.actions,
  violation: s.violation,
});

/** The parts in which two runs differ: none, when one is the other's replay. */
function differences(a: Sim, b: Sim): string[] {
  const [x, y] = [parts(a), parts(b)];
  return (Object.keys(x) as (keyof typeof x)[]).filter(
    (part) => JSON.stringify(x[part]) !== JSON.stringify(y[part]),
  );
}

/** Steps a run until `reached` holds; fails the test if it never does within 60 virtual s. */
function stepUntil(sim: Sim, reached: (sim: Sim) => boolean): void {
  while (!reached(sim)) {
    if (sim.now > 60_000 || !step(sim)) throw new Error('the state the test waits for never came');
  }
}

/** A vote request or AppendEntries due at the millisecond the run stands at, to a node that is up
 *  and on the sender's side of the network: the node will answer it. */
const dueNow = (s: Sim): Flight | undefined =>
  s.flights.find(
    (f) =>
      f.arrives === s.now &&
      (f.message.kind === 'vote' || f.message.kind === 'append') &&
      s.servers[f.message.to]?.up === true &&
      s.groups[f.message.from] === s.groups[f.message.to],
  );

test('determinism: an action taken between two events of one millisecond lands at its end, where replay puts it', () => {
  // Driven event by event, as the Next event button drives a run. An action records only its
  // time, and replay runs every event up to that time before it acts, so no action may land before
  // another event of its millisecond: here, a message still on its way to a node. The run is
  // compared with its replay as the action lands and again 2 s on: some early differences, such
  // as two timers drawn in the other order, are gone by then, yet they made a different run.
  const takes: Record<Action['kind'], (sim: Sim, due: Flight) => void> = {
    crash: (sim, due) => crash(sim, due.message.to),
    restart: (sim) => restart(sim, 4),
    split: (sim, due) =>
      split(
        sim,
        sim.servers.map((s) => (s.id === due.message.to ? 1 : 0)),
      ),
    heal: (sim) => heal(sim),
    write: (sim) => write(sim),
    loss: (sim) => setLoss(sim, 0.2),
  };
  const broken: string[] = [];
  for (const [kind, take] of Object.entries(takes)) {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = createSim({ seed });
      runUntil(sim, 1_000);
      // Node 5 down and node 4 cut off, so there is a node to restart and a cut to heal.
      crash(sim, 4);
      split(sim, [0, 0, 0, 1, 0]);
      stepUntil(sim, (s) => dueNow(s) !== undefined);
      take(sim, dueNow(sim) as Flight);
      const landed = differences(replay({ seed }, sim.actions, sim.now), sim);
      if (landed.length > 0)
        broken.push(
          `${kind}, seed ${seed}: as it lands, its replay differs in ${landed.join(', ')}`,
        );
      const until = sim.now + 2_000;
      runUntil(sim, until);
      const later = differences(replay({ seed }, sim.actions, until), sim);
      if (later.length > 0)
        broken.push(`${kind}, seed ${seed}: 2 s on, its replay differs in ${later.join(', ')}`);
    }
  }
  expect(broken).toEqual([]);
});

describe('running in frames', () => {
  // The page runs the simulation a frame at a time: up to a virtual time, with a limit on the
  // events of one frame (EVENTS_PER_FRAME in app.ts), so a frame never takes too long to compute.

  test('a limit stops a frame between two moments, never inside one, and the clock stands at the last event it ran', () => {
    const sim = createSim({ seed: 7 });
    runUntil(sim, 1_000);
    // Up to a moment at which two messages arrive.
    stepUntil(sim, (s) => {
      const next = nextTime(s);
      return next > s.now && s.flights.filter((f) => f.arrives === next).length > 1;
    });
    const moment = nextTime(sim);
    runUntil(sim, moment + 1_000, 1);
    // Both messages arrived, though the limit is one event, and the limit stopped the frame there:
    // the clock stands at that moment, with the events due before the frame's end still ahead.
    expect(sim.now).toBe(moment);
    expect(nextTime(sim)).toBeGreaterThan(moment);
    expect(nextTime(sim)).toBeLessThanOrEqual(moment + 1_000);
  });

  test('a limit only slows the clock: a run in frames, and the actions taken in it, replay exactly', () => {
    const broken: string[] = [];
    let short = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = createSim({ seed });
      // The page's loop, with a limit low enough to bind: 16 virtual ms a frame, a limit of 2.
      for (let frame = 1; frame <= 10_000 && sim.now < 3_000 && !sim.violation; frame++) {
        const end = Math.min(3_000, sim.now + 16);
        runUntil(sim, end, 2);
        if (sim.now < end) short += 1;
        if (frame === 50) crash(sim, leaderOf(sim)?.id ?? 0);
        if (frame === 100) write(sim);
      }
      const differ = differences(replay({ seed }, sim.actions, 3_000), sim);
      if (differ.length > 0)
        broken.push(`seed ${seed}: its replay differs in ${differ.join(', ')}`);
    }
    expect(broken).toEqual([]);
    // The limit did bind: in many frames the clock stood short of the frame's end.
    expect(short).toBeGreaterThan(100);
  });
});

test('a run the page opens with messages lost records the loss at the opening’s moment, so its actions replay it', () => {
  // Start over, or a link followed, with the slider at 30%: the loss is the run's last action.
  const sim = fresh(8, 0.3);
  expect(sim.loss).toBe(0.3);
  expect(sim.actions).toEqual([...OPENING.actions, { at: OPENING.until, kind: 'loss', loss: 0.3 }]);
  runUntil(sim, 3_000);
  write(sim);
  crash(sim, leaderOf(sim)?.id ?? 0);
  runUntil(sim, 6_000);
  expect(differences(replay({ seed: 8 }, sim.actions, 6_000), sim)).toEqual([]);
  // Without that action, the replay loses no message, and is another run.
  const unrecorded = sim.actions.filter((a) => a.kind !== 'loss');
  expect(differences(replay({ seed: 8 }, unrecorded, 6_000), sim)).not.toEqual([]);
  // With none lost nothing is recorded, and the run is the build's for its seed.
  expect(fresh(7, 0).actions).toEqual(OPENING.actions);
  expect(differences(fresh(7, 0), openingRun())).toEqual([]);
});

test('a link names a run’s seed and its loss, read as the other labs read theirs, and Start over’s seed comes back to 0 after six digits', () => {
  // Start over with the slider at 30% writes the loss, so the link opens the run that loses them.
  expect(linkTo(8, 30)).toBe('#seed-8&loss=30');
  expect(linkTo(8, 0)).toBe('#seed-8');
  expect(readRun('#seed-8&loss=30')).toEqual({ seed: 8, loss: 30 });
  for (const loss of LOSSES) expect(readRun(linkTo(9, loss))).toEqual({ seed: 9, loss });
  // A name the lab lacks, or a share the slider cannot set, is dropped: the seed still opens.
  expect(readRun('#seed-12&foo=bar')).toEqual({ seed: 12, loss: 0 });
  expect(readRun('#seed-12&loss=33')).toEqual({ seed: 12, loss: 0 });
  expect(readRun('#seed-12&loss=10')).toEqual({ seed: 12, loss: 10 });
  expect(readRun('#main')).toBeNull();
  // The link reads six digits, so the seed after the last of them is one it can name.
  expect(nextSeed(41)).toBe(42);
  expect(nextSeed(999_999)).toBe(0);
  expect(readRun(linkTo(nextSeed(999_999), 20))).toEqual({ seed: 0, loss: 20 });
  expect(readRun(`#seed-${999_999 + 1}`)).toBeNull();
});

test('the opening the page draws: a leader, three committed writes, and every follower caught up', () => {
  const sim = openingRun();
  expect(leaderOf(sim)).not.toBeNull();
  expect(sim.writes.map((w) => w.state)).toEqual(['committed', 'committed', 'committed']);
  expect(sim.violation).toBeNull();
  for (const s of sim.servers) expect(s.log).toHaveLength(3);
  // Replayed, it is the same run: the browser takes over where the picture stands.
  expect(JSON.stringify(openingRun().servers)).toBe(JSON.stringify(sim.servers));
});

describe('the cut', () => {
  type Point = readonly [number, number];
  /** Every split of five nodes into two runs of the circle: one node cut off, or two. */
  const splits = [1, 2].flatMap((n) =>
    Array.from({ length: 5 }, (_, start) =>
      Array.from({ length: 5 }, (_, id) => ((id - start + 5) % 5 < n ? 1 : 0)),
    ),
  );
  const corners = (d: string): Point[] =>
    d
      .slice(1, -1)
      .split('L')
      .map((p) => p.split(' ').map(Number) as [number, number]);
  /** How far a point is from the fence: negative inside, positive outside. */
  function reach(fence: readonly Point[], [px, py]: Point): number {
    let nearest = Infinity;
    const sides = fence.map((a, i) => {
      const b = fence[(i + 1) % fence.length]!;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(
        0,
        Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)),
      );
      nearest = Math.min(nearest, Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy));
      return dx * (py - a[1]) - dy * (px - a[0]);
    });
    const inside = sides.every((c) => c > 0) || sides.every((c) => c < 0);
    return inside ? -nearest : nearest;
  }

  test.each(splits)(
    'split %j: a fence closes off the smaller side, clear of every other node and its text',
    (...groups) => {
      const fence = corners(cutFence(groups) ?? 'MZ');
      const cutOff = groups.filter((g) => g === 1).length <= 2 ? 1 : 0;
      for (const [id, g] of groups.entries())
        for (const point of footprint(id, 5, 0)) {
          if (g === cutOff) expect(reach(fence, point)).toBeLessThan(-4);
          else expect(reach(fence, point)).toBeGreaterThan(4);
        }
      for (const [x, y] of fence) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(SIZE);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(SIZE);
      }
    },
  );

  test('no fence while the network is whole, or when a side is not one run of the circle', () => {
    expect(cutFence([0, 0, 0, 0, 0])).toBeNull();
    expect(cutFence([1, 0, 1, 0, 0])).toBeNull();
  });
});
