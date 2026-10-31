import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { replay as replayBackfill } from '../src/lib/backfill/sim';
import { openingRun as backfillOpening } from '../src/lib/backfill/view';
import { replay as replayCache } from '../src/lib/cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from '../src/lib/cache/view';
import {
  backfillFact,
  backfillLine,
  cacheFact,
  cacheLine,
  figureWords,
  inWords,
  MIDDAY,
  queueFact,
  queueLine,
  raftLine,
  ROUNDS,
  routesFact,
  routesLine,
  routesWords,
  SIDING,
  spread,
  TANK,
  vanLines,
} from '../src/lib/lines';
import { replay as replayQueue } from '../src/lib/queue/sim';
import { OPENING as QUEUE, openingRun as queueOpening } from '../src/lib/queue/view';
import { openingRun, statusText } from '../src/lib/raft/view';
import type { RouteData } from '../src/lib/route-lab/data';
import type { Day } from '../src/lib/route-lab/days';
import { dayLine, NBSP } from '../src/lib/route-lab/format';
import { routeData, routeLabPicture } from '../src/lib/route-lab/picture';
import type { Measured } from '../src/lib/route-lab/plan';

// The labs' lines on Home's board and the Lab index, and their words (lib/lines.ts; ADR 0025):
// known answers first, then the real day's and the real run's, which the pages print, so a change
// to the solve or the run shows here as a change of words. Every figure on the board and the
// index comes from them, none is typed.

const app = fileURLToPath(new URL('..', import.meta.url));

/** A measured plan from each van's arrivals and return, in seconds; places are numbered from 1. */
function measured(vans: readonly { arrives: readonly number[]; back: number }[]): Measured {
  let place = 1;
  return {
    vans: vans.map((van) => ({
      stops: van.arrives.map((arrives) => ({ place: place++, arrives })),
      drive: van.back,
      metres: 0,
      boxes: van.arrives.length,
      back: van.back,
    })),
    drive: vans.reduce((sum, van) => sum + van.back, 0),
    metres: 0,
    back: Math.max(0, ...vans.filter((v) => v.arrives.length > 0).map((v) => v.back)),
  };
}

describe('the Routes line', () => {
  test('known answers: stops by when they are reached, as shares of the day, and the still board', () => {
    const line = routesLine(
      measured([
        { arrives: [600, 1200, 1800, 2400, 3000, 3600, 4200], back: 6000 },
        { arrives: [], back: 0 },
        { arrives: [300], back: 1500 },
      ]),
    );
    // A van that stays home has no track; the others keep their numbers.
    expect(line.vans.map((van) => van.name)).toEqual(['Van 1', 'Van 3']);
    expect(line.vans[0]?.stops).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(line.vans[0]?.back).toBe(1);
    expect(line.vans[1]?.back).toBe(0.25);
    // The still board is the middle round: van 1 at its sixth stop, van 3 long back.
    expect(MIDDAY).toBe(6);
    expect(line.vans.map((van) => van.now)).toEqual([6, 2]);
    expect(line.delivered).toBe(5 + 1);
  });

  test('a day the board cannot hold is refused, not drawn wrong', () => {
    const stops = Array.from({ length: ROUNDS - 1 }, (_, k) => (k + 1) * 60);
    expect(() => routesLine(measured([{ arrives: stops, back: 9000 }]))).toThrow(/rounds/);
    expect(() =>
      routesLine(measured([{ arrives: stops.slice(0, ROUNDS - 2), back: 9000 }])),
    ).not.toThrow();
  });

  test('known answers: spread lays shares out in percent, each at least the gap after the last', () => {
    expect(spread([0, 0.5, 1], 20, 80, 3)).toEqual([20, 50, 80]);
    expect(spread([0, 0.01, 0.02, 1], 20, 80, 3)).toEqual([20, 23, 26, 80]);
    expect(spread([0.1, 0.1], 0, 100, 2.5)).toEqual([10, 12.5]);
  });

  test("the vans' days in words, and the describers", () => {
    const data = {
      points: [
        { label: 'The bakery' },
        { label: 'Gas Works Park' },
        { label: 'Kerry Park' },
        { label: 'Alki Beach' },
      ],
    } as unknown as RouteData;
    const plan = measured([
      { arrives: [600, 1200], back: 2700 },
      { arrives: [900], back: 1800 },
      { arrives: [], back: 0 },
    ]);
    expect(vanLines(data, plan)).toEqual([
      `Van 1: 2 stops, Gas Works Park to Kerry Park, back after 45${NBSP}min`,
      `Van 2: 1 stop, Alki Beach, back after 30${NBSP}min`,
      'Van 3 stays at the bakery',
    ]);
    const day = { id: 'busy', name: 'A busy Saturday', vans: 3, orders: [1, 2, 3] } as Day;
    expect(routesWords(day, plan)).toBe(
      `3 orders on 2 vans: 1${NBSP}h 15${NBSP}min of driving, the last van back after 45${NBSP}min.`,
    );
    expect(figureWords(day)).toBe(
      'of driving on a busy Saturday, planned by VROOM in your browser',
    );
    // The index's one fact: the day's driving with VROOM, against the orders as they came in.
    const before = measured([{ arrives: [600], back: 7200 }]);
    const after = measured([{ arrives: [600], back: 5400 }]);
    expect(routesFact(day, before, after)).toBe(
      `A busy Saturday: 1${NBSP}h 30${NBSP}min of driving instead of 2${NBSP}h 0${NBSP}min.`,
    );
    expect(inWords(5)).toBe('five');
    expect(inWords(12)).toBe('12');
  });

  test('the caption says where the day stands in one form, the day’s end its widest', () => {
    expect(dayLine(1200, 6, 20)).toBe(`20${NBSP}min into the day: 6 of 20 orders delivered.`);
    expect(dayLine(8388, 20, 20)).toBe(
      `2${NBSP}h 20${NBSP}min into the day: 20 of 20 orders delivered.`,
    );
  });

  test('the real day: the words the chapter and the board print, from the build’s own solve', async () => {
    const picture = await routeLabPicture(app);
    const { measured: after } = picture.after;
    expect(vanLines(routeData, after)).toEqual([
      `Van 1: 9 stops, Ravenna Park to International Fountain, back after 1${NBSP}h 30${NBSP}min`,
      `Van 2: 9 stops, Pioneer Square to Alki Beach, back after 2${NBSP}h 20${NBSP}min`,
      `Van 3: 2 stops, Volunteer Park to Cal Anderson Park, back after 22${NBSP}min`,
    ]);
    expect(routesWords(picture.day, after)).toBe(
      `20 orders on 3 vans: 3${NBSP}h 12${NBSP}min of driving, the last van back after 2${NBSP}h 20${NBSP}min.`,
    );
    expect(routesFact(picture.day, picture.before.measured, after)).toBe(
      `A busy Saturday: 3${NBSP}h 12${NBSP}min of driving instead of 5${NBSP}h 34${NBSP}min.`,
    );
    const line = routesLine(after);
    expect(line.vans.map((van) => van.stops.length)).toEqual([9, 9, 2]);
    // Van 2 is the last back, so its loop ends the day; van 3's short run ends early.
    const back = (van: number) => (after.vans[van]?.back ?? 0) / after.back;
    expect(line.vans.map((van) => van.back)).toEqual([back(0), 1, back(2)]);
    expect(line.vans.map((van) => van.now)).toEqual([6, 6, 3]);
  });
});

describe('the Raft line', () => {
  test('the opening run: server 1 leads term 1 at the hub, four on spokes, three entries committed', () => {
    const line = raftLine(openingRun());
    expect(line.leader).toBe(1);
    expect(line.term).toBe(1);
    expect(line.followers).toEqual([2, 3, 4, 5]);
    expect(line.log).toEqual([true, true, true]);
    expect(line.words).toBe('Server 1 leads term 1. All five safety properties hold.');
  });

  test("the index's fact: the five properties held over every event of the opening run", () => {
    expect(statusText(openingRun())).toBe('All five safety properties held over 249 events.');
  });
});

// The three simulated labs' lines, each from its own lab's opening run, through its simulation, as
// the components draw them; each index fact from the same opening with the change its lab entry
// tells the visitor to make first. The words are the runs' own, so a change to a simulation shows
// here as a change of words, and each must agree with its lab entry (src/content/lab/).
describe('the Queue line', () => {
  test('the opening run: worker 2 down after its crash, eleven orders waiting, none dead', () => {
    const line = queueLine(queueOpening());
    expect(line.workers).toEqual([
      { name: 'Worker 1', lamp: 'lit' },
      { name: 'Worker 2', lamp: 'cross' },
      { name: 'Worker 3', lamp: 'lit' },
    ]);
    expect(line.waiting).toBe(11);
    expect(line.waiting).toBeLessThanOrEqual(TANK);
    expect(line.dead).toBe(0);
    expect(line.words).toBe('Worker 2 is down. Order 18 was printed twice, and no order was lost.');
  });

  test("the index's fact: the same crash with the idempotency key prints order 18 once", () => {
    const keyed = replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until);
    expect(queueFact(keyed)).toBe(
      'With an idempotency key, worker 2’s crash prints order 18 once: 25 orders done in 4 s, none lost or printed twice.',
    );
    // The opening itself printed order 18 twice, so it cannot be the fact.
    expect(() => queueFact(queueOpening())).toThrow(/doubled/);
  });

  test('a queue the tank cannot hold, or dead letters the siding cannot, are refused', () => {
    const sim = queueOpening();
    sim.ready.push(...Array.from({ length: TANK }, (_, k) => 100 + k));
    expect(() => queueLine(sim)).toThrow(/tank/);
    const dead = queueOpening();
    dead.dead.push(...Array.from({ length: SIDING + 1 }, (_, k) => 100 + k));
    expect(() => queueLine(dead)).toThrow(/siding/);
  });
});

describe('the Cache line', () => {
  test('the opening run, once the stampede has passed: four nodes up, one fetch running', () => {
    const line = cacheLine(cacheOpening());
    expect(line.nodes).toEqual(['filled', 'filled', 'filled', 'filled']);
    expect(line.connections).toEqual([true, false, false, false, false, false, false, false]);
    expect(line.words).toBe(
      'When the menu expired at 3.0 s, the database fetched it 23 times at once, and 2 reads timed out.',
    );
  });

  test("the index's fact: coalescing has the database fetch the menu once instead of 23 times", () => {
    const coalesced = replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until);
    expect(cacheFact(cacheOpening(), coalesced)).toBe(
      'When the menu expires at 3.0 s, coalescing has the database fetch it once instead of 23 times.',
    );
    // With no herd at an expiry there is nothing to compare.
    expect(() => cacheFact(coalesced, coalesced)).toThrow(/herd/);
  });
});

describe('the Backfill line', () => {
  test("the opening week: every run done, Wednesday's check crossed, and its words", () => {
    const line = backfillLine(backfillOpening());
    expect(line.days.map((day) => day.name)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(line.days.map((day) => day.lamp)).toEqual([
      'filled',
      'filled',
      'cross',
      'filled',
      'filled',
      'filled',
      'filled',
    ]);
    expect(line.words).toBe(
      'Wednesday’s report counts 275 orders against the source’s 179; the other six days match.',
    );
    expect(backfillLine(backfillOpening('overwrite')).words).toBe(
      'Every day matches the source: 2,012 orders in the week.',
    );
  });

  test('a week that has not started is hollow, and one under way says how far its checks got', () => {
    const off = backfillLine(replayBackfill({ seed: 9 }, [], 0));
    expect(off.days.every((day) => day.lamp === 'hollow')).toBe(true);
    expect(off.words).toBe('No day has been checked yet.');
  });

  test("the index's fact: loads that overwrite their day count the week once", () => {
    const appended = backfillOpening();
    expect(backfillFact(appended, backfillOpening('overwrite'))).toBe(
      'Loads that overwrite their day: the week’s report counts 2,012 orders, as the source does, instead of 2,108.',
    );
    // The appended week does not match its source, so it cannot be the fact.
    expect(() => backfillFact(appended, appended)).toThrow(/match/);
  });
});

// The board's stylesheet gives each lamp its place by a rule per index (styles/board.css), since
// a stylesheet cannot read a number from an attribute in every browser yet. These hold the rules
// to the model: every place a van can stand, every van the Route Lab can send, and the clock's
// span and starting round.
describe("the board's stylesheet counts what the model draws", () => {
  const css = readFileSync(join(app, 'src/styles/board.css'), 'utf8');
  const has = (selector: string, declaration: string) =>
    new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{\\s*${declaration}`).test(css);

  test('a rule for each place on a track and each van', () => {
    for (let k = 1; k < ROUNDS; k++)
      expect(has(`[data-k='${k}']`, `--k: ${k};`), `k ${k}`).toBe(true);
    for (let v = 1; v < 4; v++)
      expect(has(`[data-van='${v}']`, `--van: ${v};`), `van ${v}`).toBe(true);
    for (let n = 1; n <= 4; n++)
      expect(has(`[data-vans='${n}']`, `--every: ${n}s;`), `vans ${n}`).toBe(true);
  });

  test("the clock spans ROUNDS and starts at the still board's round", () => {
    expect(css).toContain(`animation-duration: calc(var(--every) * ${ROUNDS});`);
    expect(css).toContain(`animation-timing-function: steps(${ROUNDS});`);
    expect(css).toContain(`--day: ${ROUNDS};`);
    expect(css).toContain(`- var(--every) * ${MIDDAY + 1})`);
  });
});
