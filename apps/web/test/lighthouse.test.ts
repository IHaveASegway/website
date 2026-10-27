import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { pagesIn } from '../e2e/expected';
import { app } from './support/dist';

// Synthetic performance (design-system.md, "Budgets"; delivery.md, "Pipeline"): Lighthouse CI on
// simulated mobile, 3 runs on every page of the build, in the lighthouse job. Its limits are the
// budget table's, so a change to one without the other fails here; the job reads its pages from
// the build with e2e's own function; and its reports stay in the run, never on lhci's public
// upload storage. Known answers on the parsed files: each mutation that breaks one is named.
//
// The limits are an assertMatrix, as lhci applies it: every entry whose pattern matches a page's
// URL holds that page, and an entry that matches nothing holds nothing, silently. So each page of
// the build must meet exactly one limit per audit: 150 KB transferred everywhere, and 160 KB on
// the Route Lab's page since its space-time cube (ADR 0019).

type Assertion = [string, { maxNumericValue?: number; aggregationMethod?: string }];
interface Entry {
  matchingUrlPattern?: string;
  assertions?: Record<string, Assertion>;
}
interface Lhrc {
  ci: {
    collect?: { numberOfRuns?: number; settings?: Record<string, unknown> };
    assert?: { assertions?: Record<string, Assertion>; assertMatrix?: Entry[] };
    upload?: { target?: string };
  };
}

/** The assertions lhci would make on a page, as lhci reads the matrix: every matching entry's. */
export function assertionsFor(config: Lhrc, url: string, audit: string): Assertion[] {
  return (config.ci.assert?.assertMatrix ?? [])
    .filter((e) => new RegExp(e.matchingUrlPattern ?? '.*').test(url))
    .flatMap((e) => (e.assertions?.[audit] ? [e.assertions[audit]] : []));
}

/** The pages with a transfer budget of their own, and the budget row that holds each. */
const OWN_TRANSFER: Record<string, { row: string; limit: number; written: string }> = {
  '/lab/routes/': {
    row: "The Route Lab's transfer, first view",
    limit: 160_000,
    written: '≤ 160 KB',
  },
};
interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  needs?: string[];
  permissions?: Record<string, string>;
  steps?: Step[];
}
type Workflow = { jobs: Record<string, Job> };

const read = (path: string) => readFileSync(join(app, path), 'utf8');

/** A budget row's limit from design-system.md's table, by the row's first cell. */
export function budgetLimit(doc: string, row: string): string | undefined {
  const line = doc.split('\n').find((l) => l.startsWith(`| ${row} |`));
  return line?.split('|')[2]?.trim();
}

/** Why the config or the job does not hold the documented budgets, one line each. */
export function lighthouseProblems(
  config: Lhrc,
  workflow: Workflow,
  doc: string,
  pages: readonly string[],
): string[] {
  const problems: string[] = [];
  const { collect, assert, upload } = config.ci;
  if (assert?.assertions) problems.push('lhci has assertions outside its matrix, which it refuses');
  if (collect?.numberOfRuns !== 3) problems.push('lhci does not run 3 times per page');
  // The default settings are Lighthouse's simulated mobile; a preset would change the device.
  if (
    collect?.settings?.['preset'] !== undefined ||
    collect?.settings?.['formFactor'] !== undefined
  )
    problems.push('lhci does not run on simulated mobile');
  // Each limit, as design-system.md writes it, and the audit that measures it, on every page.
  const limits = (page: string): [string, string, number, string][] => [
    ['LCP, p75 mobile', 'largest-contentful-paint', 2500, '≤ 2.5 s'],
    ['CLS', 'cumulative-layout-shift', 0.1, '≤ 0.1'],
    OWN_TRANSFER[page]
      ? [
          OWN_TRANSFER[page].row,
          'total-byte-weight',
          OWN_TRANSFER[page].limit,
          OWN_TRANSFER[page].written,
        ]
      : ['Home transfer, first view', 'total-byte-weight', 150_000, '≤ 150 KB'],
  ];
  const rows = new Set<string>();
  for (const page of pages)
    for (const [row, audit, limit, written] of limits(page)) {
      if (!rows.has(row) && budgetLimit(doc, row) !== written)
        problems.push(`design-system.md's "${row}" limit is not ${written}`);
      rows.add(row);
      const held = assertionsFor(config, `https://preview.example${page}`, audit);
      if (held.length !== 1) {
        problems.push(`${page} has ${held.length} ${audit} limits`);
        continue;
      }
      const [level, options] = held[0] ?? [];
      if (level !== 'error' || options?.maxNumericValue !== limit)
        problems.push(`${audit} does not fail above ${limit} on ${page}`);
      if (options?.aggregationMethod !== 'median')
        problems.push(`${audit} is not read from the median of the runs on ${page}`);
    }
  if (upload?.target !== 'filesystem') problems.push('lhci uploads its reports off the run');

  const job = workflow.jobs['lighthouse'];
  const e2e = workflow.jobs['e2e'];
  if (!job) return [...problems, 'no lighthouse job'];
  if (job.if !== e2e?.if) problems.push('lighthouse does not run when e2e does');
  for (const need of ['verify', 'firewall', 'preview'])
    if (!job.needs?.includes(need)) problems.push(`lighthouse does not need ${need}`);
  if (JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' }))
    problems.push('lighthouse holds more than contents: read');
  if (JSON.stringify(job).includes('secrets.')) problems.push('lighthouse reads a secret');
  const run = job.steps?.find((s) => s.run?.includes('lhci autorun'))?.run ?? '';
  if (!run) problems.push('lighthouse does not run lhci autorun');
  if (!run.includes("import('./e2e/expected.ts')") || !run.includes("pagesIn('dist')"))
    problems.push("lighthouse does not read its pages from the build with e2e's pagesIn");
  if (/--upload|temporary-public-storage|serverBaseUrl/.test(run))
    problems.push('lighthouse overrides where lhci uploads');
  const keep = job.steps?.find((s) => s.uses?.startsWith('actions/upload-artifact'));
  if (keep?.if !== 'failure()') problems.push('lighthouse keeps its reports on a pass');
  return problems;
}

const config = JSON.parse(read('lighthouserc.json')) as Lhrc;
const workflow = parse(read('../../.github/workflows/ci.yml')) as Workflow;
const doc = read('../../docs/design-system.md');
// The pages lhci measures, as its job finds them; Home and the Route Lab's whatever this build holds.
const pages = [...new Set(['/', '/lab/routes/', ...pagesIn(join(app, 'dist'))])];

test("lhci's limits are the budget table's, one per page, and its job reads every page of the build", () => {
  expect(lighthouseProblems(config, workflow, doc, pages)).toEqual([]);
});

test('known answers: a limit, a run count, an upload target or a page list that drifts is named', () => {
  const two = ['/', '/lab/routes/'];
  const mutated = (change: (c: Lhrc, w: Workflow) => void, text = doc, on = two) => {
    const c = structuredClone(config);
    const w = structuredClone(workflow);
    change(c, w);
    return lighthouseProblems(c, w, text, on);
  };
  const entry = (c: Lhrc, k: number) => c.ci.assert?.assertMatrix?.[k] ?? {};
  const asserts = (c: Lhrc, k: number) => entry(c, k).assertions ?? {};
  expect(
    mutated((c) => {
      asserts(c, 0)['largest-contentful-paint'] = [
        'warn',
        { maxNumericValue: 2500, aggregationMethod: 'median' },
      ];
    }),
  ).toEqual([
    'largest-contentful-paint does not fail above 2500 on /',
    'largest-contentful-paint does not fail above 2500 on /lab/routes/',
  ]);
  expect(
    mutated((c) => {
      asserts(c, 1)['total-byte-weight'] = [
        'error',
        { maxNumericValue: 200 * 1024, aggregationMethod: 'median' },
      ];
    }),
  ).toEqual(['total-byte-weight does not fail above 150000 on /']);
  // The Route Lab's own limit is 160 KB; Home's 150 KB on it is a drift too.
  expect(
    mutated((c) => {
      asserts(c, 2)['total-byte-weight'] = [
        'error',
        { maxNumericValue: 150_000, aggregationMethod: 'median' },
      ];
    }),
  ).toEqual(['total-byte-weight does not fail above 160000 on /lab/routes/']);
  // A pattern that matches nothing holds nothing, and lhci says nothing: the page is named.
  expect(
    mutated((c) => {
      entry(c, 2).matchingUrlPattern = '/lab/route/$';
    }),
  ).toEqual(['/lab/routes/ has 0 total-byte-weight limits']);
  // Two entries on one page: the stricter would win in lhci, whatever the table says.
  expect(
    mutated((c) => {
      entry(c, 1).matchingUrlPattern = '.*';
    }),
  ).toEqual(['/lab/routes/ has 2 total-byte-weight limits']);
  expect(
    mutated((c) => {
      if (c.ci.assert) c.ci.assert.assertions = {};
    }),
  ).toEqual(['lhci has assertions outside its matrix, which it refuses']);
  expect(
    mutated(
      (c) => {
        asserts(c, 0)['cumulative-layout-shift'] = [
          'error',
          { maxNumericValue: 0.1, aggregationMethod: 'optimistic' },
        ];
      },
      doc,
      ['/'],
    ),
  ).toEqual(['cumulative-layout-shift is not read from the median of the runs on /']);
  expect(mutated(() => {}, doc.replace('| CLS | ≤ 0.1 |', '| CLS | ≤ 0.25 |'))).toEqual([
    'design-system.md\'s "CLS" limit is not ≤ 0.1',
  ]);
  expect(
    mutated((c) => {
      if (c.ci.collect) c.ci.collect.numberOfRuns = 1;
      if (c.ci.upload) c.ci.upload.target = 'temporary-public-storage';
    }),
  ).toEqual(['lhci does not run 3 times per page', 'lhci uploads its reports off the run']);
  expect(
    mutated((c) => {
      if (c.ci.collect?.settings) c.ci.collect.settings['preset'] = 'desktop';
    }),
  ).toEqual(['lhci does not run on simulated mobile']);
  expect(
    mutated((_, w) => {
      const step = w.jobs['lighthouse']?.steps?.find((s) => s.run?.includes('lhci autorun'));
      if (step) step.run = 'pnpm exec lhci autorun --collect.url=http://127.0.0.1:8787/';
    }),
  ).toEqual(["lighthouse does not read its pages from the build with e2e's pagesIn"]);
  expect(
    mutated((_, w) => {
      const job = w.jobs['lighthouse'];
      if (job) job.permissions = { contents: 'read', 'pull-requests': 'write' };
    }),
  ).toEqual(['lighthouse holds more than contents: read']);
  expect(
    mutated((_, w) => {
      const keep = w.jobs['lighthouse']?.steps?.find((s) =>
        s.uses?.startsWith('actions/upload-artifact'),
      );
      if (keep) keep.if = 'always()';
    }),
  ).toEqual(['lighthouse keeps its reports on a pass']);
});
