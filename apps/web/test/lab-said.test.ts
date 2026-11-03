import { describe, expect, test } from 'vitest';
import {
  replay as replayBackfill,
  failNextLoad,
  start,
  type Sim as BackfillSim,
} from '../src/lib/backfill/sim';
import { OPENING as BACKFILL } from '../src/lib/backfill/view';
import {
  flush,
  loseNode,
  replay as replayCache,
  restoreNode,
  setPlacement,
  setToggle,
  write,
} from '../src/lib/cache/sim';
import { OPENING as CACHE } from '../src/lib/cache/view';
import { SAID_ROOM, shortly, startsOver } from '../src/lib/lab/said';
import {
  createSim,
  crash,
  poison,
  setAck,
  setKey,
  setPoisonHandling,
  setPrefetch,
  stopProducer,
  runUntil as runQueue,
} from '../src/lib/queue/sim';
import { OPENING as QUEUE, REPLAY_WORDS as QUEUE_WORDS, stopWords } from '../src/lib/queue/view';
import {
  crash as crashServer,
  heal,
  replay as replayRaft,
  restart as restartServer,
  runUntil as runRaft,
  split,
  write as writeRaft,
} from '../src/lib/raft/sim';
import { OPENING as RAFT } from '../src/lib/raft/view';
import { REPLAY_WORDS as CACHE_WORDS } from '../src/lib/cache/view';
import { REPLAY_WORDS as BACKFILL_WORDS, STORY_WORDS } from '../src/lib/backfill/view';

// The line on the screen that says what a press did (lib/lab/said.ts). Its room holds SAID_ROOM
// characters at the narrowest phone (e2e/steady.spec.ts), so whatever a run can say has to come out
// that short: whole sentences, as many as fit, since the event log has the rest.

describe('shortly', () => {
  test('known answers: whole sentences, as many as fit, and always the first', () => {
    expect(shortly('Node 1 is lost.')).toBe('Node 1 is lost.');
    const long = 'a'.repeat(100);
    expect(shortly(`${long}. ${long}.`)).toBe(`${long}.`);
    expect(shortly(`Short one. Short two. ${long}. ${long}. Short three.`)).toBe(
      `Short one. Short two. ${long}.`,
    );
    // A decimal's point is no sentence's end.
    expect(shortly(`It expires at 12.483 s. ${long}. ${long}.`)).toBe(
      `It expires at 12.483 s. ${long}.`,
    );
    // No sentence in it that fits leaves the first, whole, and a line of the log gets its point.
    expect(shortly('b'.repeat(200))).toHaveLength(201);
    expect(shortly('Node 1 is back, empty')).toBe('Node 1 is back, empty.');
    expect(shortly('')).toBe('');
  });
});

/** Every line a run can say on a press, from one that has had one of everything done to it. */
function queueLines(): string[] {
  const texts: string[] = [];
  for (const prefetch of [1, 10]) {
    const sim = createSim({ ...QUEUE.config, prefetch });
    runQueue(sim, 3_000);
    setPrefetch(sim, 2);
    setPrefetch(sim, prefetch);
    poison(sim);
    runQueue(sim, 5_000);
    setPoisonHandling(sim, 'dead-letter');
    crash(sim, 0);
    setAck(sim, 'before');
    crash(sim, 2);
    setKey(sim, true);
    stopProducer(sim);
    runQueue(sim, 40_000);
    texts.push(...sim.lines.map((line) => line.text));
  }
  return texts;
}

function cacheLines(): string[] {
  const sim = replayCache(CACHE.config, CACHE.actions, CACHE.until);
  setPlacement(sim, 'modulo');
  loseNode(sim, 0);
  loseNode(sim, 1);
  restoreNode(sim, 0);
  setToggle(sim, 'invalidate', false);
  write(sim, 0);
  setToggle(sim, 'jitter', true);
  flush(sim);
  return sim.lines.map((line) => line.text);
}

function backfillLines(): string[] {
  const sim: BackfillSim = replayBackfill(BACKFILL.config, BACKFILL.actions, BACKFILL.until);
  failNextLoad(sim, 0);
  start(sim);
  return sim.lines.map((line) => line.text);
}

/** A write taken on each side of a cut, the old leader's dropped when it heals, and two crashes. */
function raftLines(): string[] {
  const sim = replayRaft({ seed: RAFT.seed }, RAFT.actions, RAFT.until);
  split(sim, [1, 1, 0, 0, 0]);
  writeRaft(sim);
  runRaft(sim, 2_500);
  writeRaft(sim);
  runRaft(sim, 3_500);
  heal(sim);
  runRaft(sim, 4_500);
  writeRaft(sim);
  runRaft(sim, 6_000);
  crashServer(sim, 0);
  crashServer(sim, 1);
  restartServer(sim, 0);
  runRaft(sim, 7_000);
  return sim.lines.map((line) => line.text);
}

describe('what a run says fits the room its line keeps', () => {
  const lines = {
    raft: raftLines(),
    queue: queueLines(),
    cache: cacheLines(),
    backfill: backfillLines(),
  };

  for (const [lab, texts] of Object.entries(lines))
    test(`the ${lab} lab's lines`, () => {
      expect(texts.length).toBeGreaterThan(10);
      expect(texts.filter((text) => shortly(`${text}.`).length > SAID_ROOM)).toEqual([]);
    });

  test('the words a lab writes for a press of its own', () => {
    const said = [
      startsOver('run', 'these settings', 'at 1.400 s, before the leader crashes', false),
      'There is no leader to cut off right now.',
      'The network is already whole.',
      'From here, 50% of messages are lost.',
      'Virtual time 1234.567 s, 1,234,567 events.',
      startsOver('run', 'these settings', QUEUE_WORDS, false),
      startsOver('run', 'these settings', CACHE_WORDS, false),
      startsOver('week', 'these settings', BACKFILL_WORDS, false),
      `The idempotency key is off. ${startsOver('run', 'it', QUEUE_WORDS, false)}`,
      `Stale-while-revalidate is off. ${startsOver('run', 'it', CACHE_WORDS, false)}`,
      ...Object.values(STORY_WORDS).map(
        (words) => `${words}. ${startsOver('week', 'it', BACKFILL_WORDS, false)}`,
      ),
      "Wednesday's next load will fail part way. Wednesday has loaded already, so this fails its load when the week plays again, or after a clear.",
      "Wednesday's file is 5 hours late, so the week goes back to before the job is switched on. Press Run to watch it.",
    ];
    // Why a queue's clock stops, drained or with no worker up, at the most orders a run has waiting.
    const stopped = createSim({ ...QUEUE.config });
    said.push(stopWords(stopped));
    stopped.ready.push(...Array.from({ length: 999 }, (_, id) => id));
    said.push(stopWords(stopped));
    expect(said.filter((words) => words.length > SAID_ROOM)).toEqual([]);
  });

  test('a run that went back says so in one sentence, the same in every lab', () => {
    expect(startsOver('run', 'these settings', QUEUE_WORDS, false)).toBe(
      "The run starts over under these settings, at 1.500 s, before worker 2's crash. Press Run to watch it.",
    );
    expect(startsOver('run', 'it', CACHE_WORDS, true)).toBe(
      'The run starts over under it, at 2.500 s, before the menu expires.',
    );
    expect(startsOver('week', 'these settings', BACKFILL_WORDS, false)).toBe(
      'The week starts over under these settings, at 00:00, before the job is switched on. Press Run to watch it.',
    );
  });
});
