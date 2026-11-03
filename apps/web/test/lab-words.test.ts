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
import { app, fileFor, html, profile, read } from './support/dist';

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

// A row of the résumé's skills that opens a lab can name only what that lab shows. The labs name no
// product (docs/lab.md), so the tools line says what Joseph has used, and the row should say what the
// page does. Two rows don't yet, under a note that says "working": About's words are held for its
// overhaul, and Joseph hasn't read a rewrite of them, so they stand here as the list that overhaul
// has to clear. It can only shrink, as test/language.test.ts's list does.
const ROWS_AWAITING_THE_ABOUT_OVERHAUL: Readonly<Record<string, readonly string[]>> = {
  'Message brokers: RabbitMQ, LavinMQ, SQS': ['RabbitMQ', 'LavinMQ', 'SQS'],
  'Scheduled pipelines: Airflow': ['Airflow'],
};

describe('a skill promises what its page shows', () => {
  const TOOLS = (profile.tools ?? '')
    .split(/[,.]\s*|\s+and\s+|\s+on\s+/)
    .map((tool) => tool.trim())
    .filter(Boolean);
  /** The tools a row names that its page never does. */
  const unbacked = (row: string, page: string) =>
    TOOLS.filter((tool) => new RegExp(`\\b${tool}\\b`).test(row) && !page.includes(tool));

  test('known answers: the tools line is read, and a tool the page does not name is caught', () => {
    expect(TOOLS).toContain('RabbitMQ');
    expect(TOOLS).toContain('Airflow');
    expect(unbacked('Message brokers: RabbitMQ, LavinMQ, SQS', 'a simulated broker')).toEqual([
      'RabbitMQ',
      'LavinMQ',
      'SQS',
    ]);
    expect(unbacked('Message queues: acks, idempotency keys', 'a simulated broker')).toEqual([]);
    expect(unbacked('TypeScript', 'one TypeScript module')).toEqual([]);
  });

  const toLabs = profile.skills.flatMap((skill) =>
    skill.evidence
      .filter((href) => href.startsWith('/lab/'))
      .map((href) => [skill.name, href] as const),
  );
  test.each(toLabs)('%s, on %s', (name, href) => {
    expect(unbacked(name, words(read(`${fileFor(href)}index.html`)))).toEqual(
      ROWS_AWAITING_THE_ABOUT_OVERHAUL[name] ?? [],
    );
  });

  test('the note over the rows stands as Joseph last read it, until the overhaul replaces both', () => {
    expect(words(read('about/index.html'))).toContain('What you can see working here:');
  });
});
