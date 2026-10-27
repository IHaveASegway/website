import { termAt, type Server } from './core';

// Raft's five safety properties (Figure 3 of the paper), checked after every event of a run. Each
// check is a few comparisons, not a walk over every log: logs are compared by their prefix
// fingerprints (Server.hashes), so equal fingerprints at an index mean equal logs up to it.

export const PROPERTIES = [
  'Election Safety',
  'Leader Append-Only',
  'Log Matching',
  'Leader Completeness',
  'State Machine Safety',
] as const;

export type Property = (typeof PROPERTIES)[number];

export interface Violation {
  readonly property: Property;
  readonly at: number;
  readonly detail: string;
}

interface Committed {
  readonly term: number;
  readonly write: number;
  readonly hash: number;
  /** The term the commit was first seen in: the committing leader's. */
  readonly inTerm: number;
}

export interface Checker {
  /** The leader of each term seen so far. */
  readonly leaders: Map<number, number>;
  /** What each committed index holds, by index (1-based; index 0 unused). */
  readonly committed: (Committed | undefined)[];
  /** Each current leader's log when last seen: its term, its length and its fingerprint. */
  readonly leaderLogs: Map<number, { term: number; length: number; hash: number }>;
  /** How many of each server's applied writes have been checked, and in which array: a crash
   *  starts a new one, so a restarted server's writes are checked again as it re-applies them. */
  readonly checkedApplied: { list: readonly number[]; count: number }[];
}

export const createChecker = (): Checker => ({
  leaders: new Map(),
  committed: [],
  leaderLogs: new Map(),
  checkedApplied: [],
});

const name = (id: number) => `node ${id + 1}`;

/** The first property the servers break now, or null. */
export function check(c: Checker, servers: readonly Server[], now: number): Violation | null {
  const fail = (property: Property, detail: string): Violation => ({ property, at: now, detail });

  for (const s of servers) {
    if (s.role !== 'leader' || !s.up) {
      c.leaderLogs.delete(s.id);
      continue;
    }
    // Election Safety: at most one leader in a term.
    const known = c.leaders.get(s.term);
    if (known !== undefined && known !== s.id)
      return fail('Election Safety', `${name(known)} and ${name(s.id)} both lead term ${s.term}`);
    c.leaders.set(s.term, s.id);

    // Leader Append-Only: a leader never overwrites or deletes an entry in its own log.
    const before = c.leaderLogs.get(s.id);
    if (
      before &&
      before.term === s.term &&
      (s.log.length < before.length || s.hashes[before.length] !== before.hash)
    )
      return fail(
        'Leader Append-Only',
        `${name(s.id)} changed its log while leading term ${s.term}`,
      );
    c.leaderLogs.set(s.id, {
      term: s.term,
      length: s.log.length,
      hash: s.hashes[s.log.length] ?? 0,
    });
  }

  // Log Matching: if two logs hold an entry of the same term at an index, they are identical up
  // to it. The last index where the terms agree decides it: equal fingerprints there mean equal
  // logs before it, and past it no index has equal terms.
  for (let a = 0; a < servers.length; a++) {
    for (let b = a + 1; b < servers.length; b++) {
      const x = servers[a] as Server;
      const y = servers[b] as Server;
      let k = Math.min(x.log.length, y.log.length);
      while (k > 0 && termAt(x, k) !== termAt(y, k)) k--;
      if (k > 0 && x.hashes[k] !== y.hashes[k])
        return fail(
          'Log Matching',
          `${name(a)} and ${name(b)} agree on the term at index ${k} but not on what comes before`,
        );
    }
  }

  // State Machine Safety: no two servers commit or apply different entries at one index.
  for (const s of servers) {
    if (s.commitIndex > s.log.length)
      return fail('State Machine Safety', `${name(s.id)} has committed entries it no longer holds`);
    for (let k = Math.max(1, c.committed.length); k <= s.commitIndex; k++) {
      c.committed[k] = {
        term: termAt(s, k),
        write: s.log[k - 1]?.write ?? 0,
        hash: s.hashes[k] ?? 0,
        inTerm: s.term,
      };
    }
    const top = s.commitIndex;
    if (top > 0 && c.committed[top]?.hash !== s.hashes[top])
      return fail(
        'State Machine Safety',
        `${name(s.id)} committed a different entry at index ${top} than another server did`,
      );
    const seen = c.checkedApplied[s.id];
    const from = seen?.list === s.applied ? seen.count : 0;
    for (let k = from + 1; k <= s.applied.length; k++) {
      if (s.applied[k - 1] !== c.committed[k]?.write)
        return fail(
          'State Machine Safety',
          `${name(s.id)} applied a different write at index ${k} than another server did`,
        );
    }
    c.checkedApplied[s.id] = { list: s.applied, count: s.applied.length };
  }

  // Leader Completeness: the leader of a later term holds every entry committed before it. A
  // leader of an older term, cut off in a minority, may lack what the majority committed since.
  for (const s of servers) {
    if (s.role !== 'leader' || !s.up) continue;
    let k = c.committed.length - 1;
    while (k > 0 && (c.committed[k] as Committed).inTerm >= s.term) k--;
    if (k > 0 && s.hashes[k] !== (c.committed[k] as Committed).hash)
      return fail(
        'Leader Completeness',
        `${name(s.id)} leads term ${s.term} without the entry committed at index ${k}`,
      );
  }
  return null;
}
