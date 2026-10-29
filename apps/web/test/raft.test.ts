import { describe, expect, test } from 'vitest';
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
  replay,
  restart,
  runUntil,
  seeded,
  setLoss,
  split,
  write,
  type Sim,
} from '../src/lib/raft/sim';
import { openingRun, SEEDS_IN_CI } from '../src/lib/raft/view';

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

test('the opening the page draws: a leader, three committed writes, and every follower caught up', () => {
  const sim = openingRun();
  expect(leaderOf(sim)).not.toBeNull();
  expect(sim.writes.map((w) => w.state)).toEqual(['committed', 'committed', 'committed']);
  expect(sim.violation).toBeNull();
  for (const s of sim.servers) expect(s.log).toHaveLength(3);
  // Replayed, it is the same run: the browser takes over where the picture stands.
  expect(JSON.stringify(openingRun().servers)).toBe(JSON.stringify(sim.servers));
});
