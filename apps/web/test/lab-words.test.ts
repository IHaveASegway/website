import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { days } from '../src/lib/route-lab/days';
import { formatDuration } from '../src/lib/route-lab/format';
import { loadSolver } from '../src/lib/route-lab/node-solver';
import { routeData } from '../src/lib/route-lab/picture';
import {
  capacityFor,
  dealtInTurn,
  explorationFor,
  fromVroom,
  measure,
  vroomInput,
  type Measured,
} from '../src/lib/route-lab/plan';
import { app, html, read } from './support/dist';

// The labs' words against the site's language (docs/content.md, "The site's language"; ADR 0029),
// where test/language.test.ts's list of retired phrases can't reach: a rule about the order of two
// words on a page, a word only some labs may use, the shape every write-up shares, and the figures a
// write-up types. Each was a defect a reader found on 2026-11-02: a recruiter arriving by a direct
// link could take the bakery for a client, and a tech lead could open a skill's lab and not find it.

const LAB = join(app, 'src/content/lab');
const slugs = readdirSync(LAB)
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.replace(/\.md$/, ''));
const entry = (slug: string) => readFileSync(join(LAB, `${slug}.md`), 'utf8');
const bodyOf = (slug: string) => entry(slug).replace(/^---\n[\s\S]*?\n---\n/, '');

/** A page's words: its markup with scripts, styles, drawings and tags taken out. */
const words = (page: string) =>
  page
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ');

/** Whether text says "the bakery" before it has said the bakery is made up. */
const takesTheBakeryForReal = (text: string): boolean => {
  const first = text.search(/\bthe bakery\b/i);
  return first >= 0 && !text.slice(0, first).includes('made-up');
};

describe('the made-up bakery, on first mention in a page', () => {
  test('known answers', () => {
    expect(takesTheBakeryForReal('Three workers take the bakery’s orders.')).toBe(true);
    expect(takesTheBakeryForReal('A made-up bakery. Then the bakery’s orders.')).toBe(false);
    expect(takesTheBakeryForReal('A bakery, its vans and the day’s orders.')).toBe(false);
    expect(takesTheBakeryForReal('Nothing here.')).toBe(false);
  });

  for (const file of html)
    test(file, () => {
      expect(takesTheBakeryForReal(words(read(file)))).toBe(false);
    });

  // A summary travels alone: the card, the link preview, the feed for language models, the printed
  // résumé's Selected work.
  test.each(slugs)('the %s lab’s summary says so wherever it names a bakery', (slug) => {
    const summary = /^summary: (.*)$/m.exec(entry(slug))?.[1] ?? '';
    expect(summary.length).toBeGreaterThan(0);
    if (/bakery/i.test(summary)) expect(summary).toMatch(/made-up bakery/);
  });
});

describe('checks, and safety properties only in Raft', () => {
  test.each(['queue', 'cache', 'backfill'])('/lab/%s/ says checks', (slug) => {
    expect(words(read(`lab/${slug}/index.html`))).not.toMatch(/\bpropert(y|ies)\b/i);
  });

  test('a write-up uses the words the glossary keeps: dots, labs, US English', () => {
    const found = slugs.flatMap((slug) =>
      [...bodyOf(slug).matchAll(/\b(cells?|demos?|colours?)\b/gi)].map(
        ([word]) => `${slug}: ${word}`,
      ),
    );
    expect(found).toEqual([]);
  });
});

describe('every write-up has one shape', () => {
  const headings = (slug: string) =>
    [...bodyOf(slug).matchAll(/^## (.+)$/gm)]
      .map(([, heading = '']) => heading)
      .filter((heading) => heading !== 'Credits');

  test.each(slugs)('%s: what it promises, three things to try, how to read it', (slug) => {
    const [promise, ...rest] = headings(slug);
    expect(promise).toMatch(/^What .+ promises$/);
    expect(rest).toEqual(['Three things to try', 'How to read it', 'What it costs']);
    const tries = /^## Three things to try\n([\s\S]*?)^## /m.exec(bodyOf(slug))?.[1] ?? '';
    expect(tries.match(/^\*\*.+?\*\* /gm)).toHaveLength(3);
  });
});

// The words the page itself says, outside its entry, as a reader meets them, each with its marks curled.
// A clarity pass on 2026-11-02 chose these with what each replaces (docs/content.md, "The site's
// language"), so a later change is a choice, and a figure in one still comes from its run or its solve.
describe('what a page says of itself', () => {
  const SAID: readonly (readonly [string, string])[] = [
    [
      'index.html',
      'A simulation of five servers keeping the same log, the ordered list of every write.',
    ],
    [
      'lab/backfill/index.html',
      'A nightly job counts a made-up bakery’s orders, one run per day. Backfill the days already past, then fail a load, rerun a day, and check every total against the source.',
    ],
    [
      'lab/backfill/index.html',
      'Choose how a load writes, and the week starts over under it, before the job is switched on.',
    ],
    [
      'lab/backfill/index.html',
      'This is each day’s steps over time. A hollow bar is a sensor, the step that waits for its file. A filled bar is a step at work, and a cross is an attempt that failed. A dotted track with nothing on it is a run waiting its turn or waiting to retry, and the vertical line is the current time.',
    ],
    [
      'lab/backfill/index.html',
      'This is a deterministic simulation: the simulator controls time, the export files and every failure, with virtual time in minutes and one seeded random stream, and it records your button presses at the moment they happen.',
    ],
    [
      'lab/backfill/index.html',
      'That is how the page opens on a picture drawn when the site was built, 44 events after the job was switched on, and how your browser then replays the week and takes over at the same minute.',
    ],
    [
      'lab/cache/index.html',
      'Hundreds of readers a second hit a made-up bakery’s cache. When the menu’s saved copy expires, its readers stampede to the database. Watch it, then tame it four ways.',
    ],
    [
      'lab/cache/index.html',
      'Coalesce misses: one reader fetches a fresh copy and the rest wait for it. Serve stale while refreshing: readers get the old copy while one fetch gets a fresh one. Refresh early: a busy page gets fetched before it expires. Jitter expiry times: pages fetched together expire apart, which shows after a flush.',
    ],
    [
      'lab/cache/index.html',
      'The readers, the four nodes and the database are one TypeScript module, a deterministic simulation that runs in virtual time.',
    ],
    [
      'lab/queue/index.html',
      'Three worker programs take a made-up bakery’s orders and tell the queue when each is done. Crash one, choose when they say so, and watch an oven ticket print once, twice, or not at all.',
    ],
    ['lab/queue/index.html', 'Every run crashes worker 2 at 2.400 s, to compare settings.'],
    ['lab/queue/index.html', 'Idempotency key: skip an order already printed'],
    [
      'lab/queue/index.html',
      'Turn the idempotency key on or off, and the run starts over under it, before the same crash.',
    ],
    [
      'lab/queue/index.html',
      'Calm is 5 orders a second, Busy 9 and Rush 14. Two workers up can print about 6.5 a second.',
    ],
    ['lab/queue/index.html', 'A poison order is one that always fails.'],
    [
      'lab/queue/index.html',
      'The broker, the workers and the orders are one TypeScript module, a deterministic simulation run in virtual time.',
    ],
    [
      'lab/raft/index.html',
      'Each row is one server’s own view of the log, and each dot is one entry, with its term under it. A filled dot is committed: a majority holds it, and it can never be lost. A hollow dot means its server hasn’t heard that the entry is committed, and it may never be.',
    ],
    ['lab/raft/index.html', 'Network partition: no message crosses it'],
    [
      'lab/raft/index.html',
      'This is a deterministic simulation: the simulator controls time, the network and every random choice, with virtual time and one seeded random stream, and it records your button presses at the moment they happen.',
    ],
    [
      'lab/raft/index.html',
      'That is how the page opens on a picture drawn when the site was built, and how your browser then replays the same run and takes over at that exact moment.',
    ],
    [
      'lab/routes/index.html',
      'Without JavaScript, the page shows the plans made when the site was built, by running the same WebAssembly in Node.',
    ],
    [
      'lab/index.html',
      'Each lab explains one part of the software it takes to run a business at scale, safely and with good performance.',
    ],
    [
      'lab/index.html',
      'Most use the same made-up bakery, and the end goal is to tie them all together into that bakery’s working software.',
    ],
    ['writing/coding-by-hand/index.html', 'Try the labs: small systems you can break'],
  ];
  const nbsp = (text: string) => text.replace(/\u00a0|&nbsp;/g, ' ');

  for (const [file, sentence] of SAID)
    test.runIf(html.includes(file))(`${file}: ${sentence.slice(0, 60)}`, () => {
      expect(nbsp(words(read(file)))).toContain(sentence);
    });

  test.runIf(html.includes('lab/routes/index.html'))(
    'the Route Lab’s lead names the baseline by its one name, with its figures from the solve',
    () => {
      const page = nbsp(words(read('lab/routes/index.html')));
      expect(page).toContain(
        'VROOM, an open-source route optimizer, plans a made-up Seattle bakery’s deliveries in your browser. On a busy Saturday, it plans 3 h 12 min of driving, against 5 h 34 min as the orders came in.',
      );
      // Not "has to balance the loads": VROOM's plan under that line is 19, 18 and 5 boxes.
      expect(page).toContain(
        'Each van can carry at most 19 of the 42 boxes, 1.3 times an even split, so VROOM can’t put them all on one van.',
      );
    },
  );

  // The labs built the same way say so in one form of words, and two forms read as two mechanisms.
  // Until 2026-11-03 the four had three forms of each of these.
  const ONE_FORM = ['raft', 'queue', 'cache', 'backfill'].map((slug) => `lab/${slug}/index.html`);
  for (const file of ONE_FORM)
    test.runIf(html.includes(file))(`${file} says how a run replays in one form of words`, () => {
      const page = nbsp(words(read(file)));
      expect(page).toContain('records your button presses at the moment they happen');
      expect(page).toContain('drawn when the site was built');
      expect(page).not.toMatch(
        /presses are recorded|where they happen|drawn in advance|before any script/,
      );
    });

  // A description is an attribute, which the build's typographer never reads, so its marks are curled
  // where it's written. Writing's lead, its description and the feed say one thing.
  test.runIf(html.includes('writing/index.html'))(
    'Writing says what it is in its lead, its description and its feed, in one form of words',
    () => {
      const said = 'What I’ve been thinking about. Right now that’s coding agents.';
      const page = read('writing/index.html');
      expect(words(page)).toContain(said);
      expect(page).toContain(`<meta name="description" content="${said}">`);
      expect(read('rss.xml')).toContain(`<description>${said}</description>`);
      expect(page + read('rss.xml')).not.toMatch(/software decisions/);
    },
  );

  test.runIf(html.includes('lab/index.html'))(
    'the Lab says the same in its description as in its lead',
    () => {
      const said =
        'Each lab explains one part of the software it takes to run a business at scale, safely and with good performance. Crash them, change the settings and see what holds.';
      const page = read('lab/index.html');
      expect(words(page)).toContain(said);
      expect(page).toContain(`<meta name="description" content="${said}">`);
    },
  );
});

// The Route Lab's write-up types its figures, where a page's "How it is built" draws them from the
// code, so this holds each to VROOM's own answer for the same day and vans, from the files the site
// serves (lib/route-lab/node-solver.ts), the way e2e/queue.spec.ts plays the Queue Lab's.
describe('the Route Lab’s write-up says what VROOM answers', () => {
  const VANS = [1, 2, 3, 4];
  const planned = new Map<string, { capacity: number; dealt: Measured; vroom: Measured }>();
  // Every day at every number of vans, once: the 63 orders take a while on a busy machine, and a
  // test's own 5 seconds are not what is being checked here.
  beforeAll(async () => {
    const solver = await loadSolver(app);
    for (const day of days(routeData))
      for (const vans of VANS) {
        const capacity = capacityFor(routeData, day.orders, vans);
        const plan = fromVroom(
          solver.solve(vroomInput(routeData, day.orders, vans, capacity), {
            explorationLevel: explorationFor(day.orders.length),
          }),
          vans,
        );
        planned.set(`${day.id} ${vans}`, {
          capacity,
          dealt: measure(routeData, dealtInTurn(routeData, day.orders, vans, capacity)),
          vroom: measure(routeData, plan),
        });
      }
  }, 120_000);

  const solved = (id: string, vans: number) => {
    const plan = planned.get(`${id} ${vans}`);
    if (!plan) throw new Error(`no plan for ${id} with ${vans} vans`);
    return plan;
  };
  const writeUp = bodyOf('routes');
  const said = (seconds: number) => formatDuration(seconds).replace(/\u00a0/g, ' ');
  const used = (plan: Measured) => plan.vans.filter((van) => van.stops.length > 0).length;

  test('every order at once, on the day’s own four vans', () => {
    const everything = days(routeData).find((day) => day.id === 'everything');
    expect(everything?.vans).toBe(4);
    const { dealt, vroom } = solved('everything', 4);
    expect(writeUp).toContain(
      `dealt to four vans in turn, its ${everything?.orders.length} orders take ${said(dealt.drive)} of driving. VROOM plans them in ${said(vroom.drive)} and needs only ${used(vroom)} of the 4 vans.`,
    );
  });

  test('a busy Saturday with one van, then four', () => {
    const one = solved('busy', 1).vroom;
    const four = solved('busy', 4).vroom;
    expect(used(four)).toBe(3);
    expect(writeUp).toContain(
      `One van drives ${said(one.drive)} and is back after ${said(one.back)}. With 4, VROOM uses three of them: ${said(four.drive)} of driving, and the last van back after ${said(four.back)}.`,
    );
  });

  test('a quiet Tuesday, from two vans to three', () => {
    const two = solved('quiet', 2);
    const three = solved('quiet', 3);
    expect(three.vroom.back).toBeGreaterThan(two.vroom.back);
    expect(writeUp).toContain(
      `Each van’s room drops from ${two.capacity} boxes to ${three.capacity}, and VROOM’s last van is back later: after ${said(three.vroom.back)} instead of ${said(two.vroom.back)}.`,
    );
  });

  test('on every day one van drives the least and is back last, and a van more can end the day later', () => {
    let later = 0;
    for (const { id } of days(routeData)) {
      const [one, ...more] = VANS.map((vans) => solved(id, vans).vroom) as [
        Measured,
        ...Measured[],
      ];
      for (const plan of more) {
        expect(one.drive, id).toBeLessThan(plan.drive);
        expect(one.back, id).toBeGreaterThan(plan.back);
      }
      later += more.filter((plan, i) => plan.back > (more[i - 1] ?? one).back).length;
    }
    expect(later).toBeGreaterThan(0);
    expect(writeUp).toContain('using one van means the least driving, but that van is back last');
    expect(writeUp).toContain('the day can even end later');
  });
});
