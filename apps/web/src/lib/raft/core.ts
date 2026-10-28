// One Raft server, as Figure 2 of the paper states it (Ongaro and Ousterhout, "In Search of an
// Understandable Consensus Algorithm", USENIX ATC 2014): leader election and log replication, no
// membership changes, no snapshots. Every function is pure of the outside world: time comes in as
// `now`, randomness as `random`, and what a server sends comes back as messages for the simulator
// (sim.ts) to deliver. Indexes are 1-based, as in the paper; index 0 is the empty log's.

export type Role = 'follower' | 'candidate' | 'leader';

/** A log entry: the term it was made in and the write it carries (a write's number; 0 is none). */
export interface Entry {
  readonly term: number;
  readonly write: number;
}

export interface VoteRequest {
  readonly kind: 'vote';
  readonly term: number;
  readonly from: number;
  readonly to: number;
  readonly lastIndex: number;
  readonly lastTerm: number;
}

export interface VoteReply {
  readonly kind: 'voted';
  readonly term: number;
  readonly from: number;
  readonly to: number;
  readonly granted: boolean;
}

export interface AppendRequest {
  readonly kind: 'append';
  readonly term: number;
  readonly from: number;
  readonly to: number;
  readonly prevIndex: number;
  readonly prevTerm: number;
  readonly entries: readonly Entry[];
  readonly leaderCommit: number;
}

export interface AppendReply {
  readonly kind: 'appended';
  readonly term: number;
  readonly from: number;
  readonly to: number;
  readonly success: boolean;
  /** On success, the last index the follower now matches; on failure, where to try next. */
  readonly index: number;
}

export type Message = VoteRequest | VoteReply | AppendRequest | AppendReply;

/** What a server did that a reader of the event log would want to know. */
export type Note =
  | { readonly kind: 'election'; readonly node: number; readonly term: number }
  | { readonly kind: 'won'; readonly node: number; readonly term: number; readonly votes: number }
  | { readonly kind: 'stepped-down'; readonly node: number; readonly term: number }
  | {
      readonly kind: 'dropped';
      readonly node: number;
      readonly count: number;
      readonly from: number;
    }
  | {
      readonly kind: 'committed';
      readonly node: number;
      readonly index: number;
      readonly term: number;
    };

/** Timing, in virtual milliseconds. */
export interface Timing {
  readonly electionMin: number;
  readonly electionMax: number;
  readonly heartbeat: number;
  /** The most entries one AppendEntries carries, so a far-behind follower catches up in steps. */
  readonly batch: number;
}

export const TIMING: Timing = { electionMin: 150, electionMax: 300, heartbeat: 50, batch: 4 };

/**
 * Deliberately broken servers, for the tests only: each one is a known bug the property sweep must
 * find (test/raft.test.ts). The page never sets either.
 * - `anyLogVotes`: grant a vote without the up-to-date check of section 5.4.1.
 * - `oldTermCommits`: commit any entry a majority holds, whatever its term: the bug Figure 8 shows,
 *   which section 5.4.2's rule (commit only the current term's entries by counting) prevents.
 */
export interface Faults {
  readonly anyLogVotes?: boolean;
  readonly oldTermCommits?: boolean;
}

export interface Server {
  readonly id: number;
  readonly size: number;
  up: boolean;
  // Persistent state: kept across a crash.
  term: number;
  votedFor: number | null;
  log: Entry[];
  /** hashes[i] fingerprints entries 1..i (hashes[0] is the empty log's), so two logs can be
   *  compared at an index in one step. Derived from the log, so it survives with it. */
  hashes: number[];
  // Volatile state: lost in a crash.
  role: Role;
  leader: number | null;
  commitIndex: number;
  /** The writes applied to the state machine, in log order: entries 1..commitIndex. */
  applied: number[];
  votes: Set<number>;
  nextIndex: number[];
  matchIndex: number[];
  /** When the election timer started and when it fires; for a leader, its next heartbeat. */
  timerStart: number;
  deadline: number;
}

export const majority = (size: number): number => Math.floor(size / 2) + 1;
export const lastIndex = (s: Server): number => s.log.length;
export const termAt = (s: Server, index: number): number =>
  index === 0 ? 0 : (s.log[index - 1]?.term ?? -1);

const mix = (hash: number, entry: Entry): number =>
  Math.imul(Math.imul(hash ^ entry.term, 0x01000193) ^ (entry.write + 0x9e37), 0x01000193) >>> 0;

/** The log's fingerprints from `from` on, after the log changed there. */
function rehash(s: Server, from: number): void {
  s.hashes.length = from;
  for (let i = from; i <= s.log.length; i++) {
    s.hashes[i] = mix(s.hashes[i - 1] ?? 0x811c9dc5, s.log[i - 1] as Entry);
  }
}

const electionTimeout = (timing: Timing, random: () => number): number =>
  timing.electionMin + Math.floor(random() * (timing.electionMax - timing.electionMin));

function resetTimer(s: Server, now: number, timing: Timing, random: () => number): void {
  s.timerStart = now;
  s.deadline = now + electionTimeout(timing, random);
}

export function createServer(
  id: number,
  size: number,
  now: number,
  timing: Timing,
  random: () => number,
): Server {
  const s: Server = {
    id,
    size,
    up: true,
    term: 0,
    votedFor: null,
    log: [],
    hashes: [0x811c9dc5],
    role: 'follower',
    leader: null,
    commitIndex: 0,
    applied: [],
    votes: new Set(),
    nextIndex: [],
    matchIndex: [],
    timerStart: now,
    deadline: now,
  };
  resetTimer(s, now, timing, random);
  return s;
}

/** A crash: the server stops, and keeps only its persistent state. */
export function crash(s: Server): void {
  s.up = false;
  s.role = 'follower';
  s.leader = null;
  s.commitIndex = 0;
  s.applied = [];
  s.votes = new Set();
  s.nextIndex = [];
  s.matchIndex = [];
}

/** A restart: a follower again, with its term, its vote and its log, and a fresh timer. */
export function restart(s: Server, now: number, timing: Timing, random: () => number): void {
  s.up = true;
  resetTimer(s, now, timing, random);
}

/** Rule for all servers: a higher term seen in any message makes this server a follower in it. */
function adopt(s: Server, term: number, notes: Note[]): void {
  if (term <= s.term) return;
  if (s.role !== 'follower') notes.push({ kind: 'stepped-down', node: s.id, term });
  s.term = term;
  s.votedFor = null;
  s.role = 'follower';
  s.leader = null;
}

function appendFor(s: Server, peer: number, timing: Timing): AppendRequest {
  const next = s.nextIndex[peer] ?? lastIndex(s) + 1;
  const prevIndex = next - 1;
  return {
    kind: 'append',
    term: s.term,
    from: s.id,
    to: peer,
    prevIndex,
    prevTerm: termAt(s, prevIndex),
    entries: s.log.slice(prevIndex, prevIndex + timing.batch),
    leaderCommit: s.commitIndex,
  };
}

const peers = (s: Server): number[] =>
  Array.from({ length: s.size }, (_, i) => i).filter((i) => i !== s.id);

function apply(s: Server, upTo: number): void {
  s.commitIndex = upTo;
  for (let i = s.applied.length + 1; i <= upTo; i++) s.applied.push(s.log[i - 1]?.write ?? 0);
}

/** A leader's commit rule: the highest index a majority holds, only if it is from this term. */
function advanceCommit(s: Server, faults: Faults, notes: Note[]): void {
  for (let n = lastIndex(s); n > s.commitIndex; n--) {
    if (!faults.oldTermCommits && termAt(s, n) !== s.term) continue;
    const holders = s.matchIndex.filter((m, i) => i === s.id || m >= n).length;
    if (holders >= majority(s.size)) {
      apply(s, n);
      notes.push({ kind: 'committed', node: s.id, index: n, term: termAt(s, n) });
      return;
    }
  }
}

/** Time passing: a leader's heartbeat, or a follower's or candidate's election timeout. */
export function tick(
  s: Server,
  now: number,
  timing: Timing,
  random: () => number,
  notes: Note[],
): Message[] {
  if (!s.up || now < s.deadline) return [];
  if (s.role === 'leader') {
    s.deadline = now + timing.heartbeat;
    return peers(s).map((peer) => appendFor(s, peer, timing));
  }
  s.term += 1;
  s.role = 'candidate';
  s.votedFor = s.id;
  s.leader = null;
  s.votes = new Set([s.id]);
  resetTimer(s, now, timing, random);
  notes.push({ kind: 'election', node: s.id, term: s.term });
  return peers(s).map((peer) => ({
    kind: 'vote',
    term: s.term,
    from: s.id,
    to: peer,
    lastIndex: lastIndex(s),
    lastTerm: termAt(s, lastIndex(s)),
  }));
}

/** A leader takes a write: it appends the entry, and the next heartbeat carries it. */
export function propose(s: Server, write: number): number | null {
  if (!s.up || s.role !== 'leader') return null;
  s.log.push({ term: s.term, write });
  rehash(s, s.log.length);
  s.matchIndex[s.id] = lastIndex(s);
  return lastIndex(s);
}

function becomeLeader(s: Server, now: number, timing: Timing, notes: Note[]): Message[] {
  s.role = 'leader';
  s.leader = s.id;
  s.nextIndex = Array.from({ length: s.size }, () => lastIndex(s) + 1);
  s.matchIndex = Array.from({ length: s.size }, (_, i) => (i === s.id ? lastIndex(s) : 0));
  s.timerStart = now;
  s.deadline = now + timing.heartbeat;
  notes.push({ kind: 'won', node: s.id, term: s.term, votes: s.votes.size });
  return peers(s).map((peer) => appendFor(s, peer, timing));
}

/** A message arriving: Figure 2's receiver rules, then a reply where the RPC has one. */
export function receive(
  s: Server,
  m: Message,
  now: number,
  timing: Timing,
  random: () => number,
  notes: Note[],
  faults: Faults = {},
): Message[] {
  if (!s.up) return [];
  adopt(s, m.term, notes);

  switch (m.kind) {
    case 'vote': {
      const upToDate =
        m.lastTerm > termAt(s, lastIndex(s)) ||
        (m.lastTerm === termAt(s, lastIndex(s)) && m.lastIndex >= lastIndex(s));
      const granted =
        m.term === s.term &&
        (s.votedFor === null || s.votedFor === m.from) &&
        (upToDate || Boolean(faults.anyLogVotes));
      if (granted) {
        s.votedFor = m.from;
        resetTimer(s, now, timing, random);
      }
      return [{ kind: 'voted', term: s.term, from: s.id, to: m.from, granted }];
    }

    case 'voted': {
      if (s.role !== 'candidate' || m.term !== s.term || !m.granted) return [];
      s.votes.add(m.from);
      return s.votes.size >= majority(s.size) ? becomeLeader(s, now, timing, notes) : [];
    }

    case 'append': {
      const reply = (success: boolean, index: number): AppendReply => ({
        kind: 'appended',
        term: s.term,
        from: s.id,
        to: m.from,
        success,
        index,
      });
      if (m.term < s.term) return [reply(false, 0)];
      // A current leader exists: a candidate of this term gives up, and the timer starts again.
      if (s.role === 'candidate') {
        s.role = 'follower';
        notes.push({ kind: 'stepped-down', node: s.id, term: s.term });
      }
      s.leader = m.from;
      resetTimer(s, now, timing, random);
      // The consistency check: this log must hold the leader's entry at prevIndex. If it is too
      // short, the leader may jump back to its end; if the terms differ, it backs up by one.
      if (m.prevIndex > lastIndex(s)) return [reply(false, lastIndex(s) + 1)];
      if (termAt(s, m.prevIndex) !== m.prevTerm) return [reply(false, m.prevIndex)];
      let index = m.prevIndex;
      for (const entry of m.entries) {
        index += 1;
        if (termAt(s, index) === entry.term) continue;
        // A conflict: this entry and everything after it go, then the leader's follow.
        if (index <= lastIndex(s)) {
          const from = index;
          const count = lastIndex(s) - index + 1;
          s.log.length = index - 1;
          notes.push({ kind: 'dropped', node: s.id, count, from });
        }
        s.log.push(entry);
        rehash(s, index);
      }
      const matched = m.prevIndex + m.entries.length;
      // Up to the leader's commit, but only as far as this message proves the logs match, and
      // never back: a late heartbeat may prove less than an earlier one did.
      const commit = Math.min(m.leaderCommit, matched);
      if (commit > s.commitIndex) apply(s, commit);
      return [reply(true, matched)];
    }

    case 'appended': {
      if (s.role !== 'leader' || m.term !== s.term) return [];
      if (m.success) {
        s.matchIndex[m.from] = Math.max(s.matchIndex[m.from] ?? 0, m.index);
        s.nextIndex[m.from] = (s.matchIndex[m.from] ?? 0) + 1;
        advanceCommit(s, faults, notes);
        // A follower still behind gets the next batch now, not at the next heartbeat.
        return (s.nextIndex[m.from] ?? 0) <= lastIndex(s) ? [appendFor(s, m.from, timing)] : [];
      }
      s.nextIndex[m.from] = Math.max(1, Math.min(m.index, (s.nextIndex[m.from] ?? 1) - 1));
      return [appendFor(s, m.from, timing)];
    }
  }
}
