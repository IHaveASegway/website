import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { app } from './support/dist';

// Synthetic performance (design-system.md, "Budgets"; delivery.md, "Pipeline"): Lighthouse CI on
// simulated mobile, 3 runs on every page of the build, in the lighthouse job. Its limits are the
// budget table's, so a change to one without the other fails here; the job reads its pages from
// the build with e2e's own function; and its reports stay in the run, never on lhci's public
// upload storage. Known answers on the parsed files: each mutation that breaks one is named.

type Assertion = [string, { maxNumericValue?: number; aggregationMethod?: string }];
interface Lhrc {
  ci: {
    collect?: { numberOfRuns?: number; settings?: Record<string, unknown> };
    assert?: { assertions?: Record<string, Assertion> };
    upload?: { target?: string };
  };
}
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
export function lighthouseProblems(config: Lhrc, workflow: Workflow, doc: string): string[] {
  const problems: string[] = [];
  const { collect, assert, upload } = config.ci;
  if (collect?.numberOfRuns !== 3) problems.push('lhci does not run 3 times per page');
  // The default settings are Lighthouse's simulated mobile; a preset would change the device.
  if (
    collect?.settings?.['preset'] !== undefined ||
    collect?.settings?.['formFactor'] !== undefined
  )
    problems.push('lhci does not run on simulated mobile');
  // Each limit, as design-system.md writes it, and the audit that measures it.
  const limits: [string, string, number][] = [
    ['LCP, p75 mobile', 'largest-contentful-paint', 2500],
    ['CLS', 'cumulative-layout-shift', 0.1],
    ['Home transfer, first view', 'total-byte-weight', 150_000],
  ];
  const written: Record<string, string> = {
    'largest-contentful-paint': '≤ 2.5 s',
    'cumulative-layout-shift': '≤ 0.1',
    'total-byte-weight': '≤ 150 KB',
  };
  for (const [row, audit, limit] of limits) {
    if (budgetLimit(doc, row) !== written[audit])
      problems.push(`design-system.md's "${row}" limit is not ${written[audit]}`);
    const [level, options] = assert?.assertions?.[audit] ?? [];
    if (level !== 'error' || options?.maxNumericValue !== limit)
      problems.push(`${audit} does not fail above ${limit}`);
    if (options?.aggregationMethod !== 'median')
      problems.push(`${audit} is not read from the median of the runs`);
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

test("lhci's limits are the budget table's, and its job reads every page of the build", () => {
  expect(lighthouseProblems(config, workflow, doc)).toEqual([]);
});

test('known answers: a limit, a run count, an upload target or a page list that drifts is named', () => {
  const mutated = (change: (c: Lhrc, w: Workflow) => void, text = doc) => {
    const c = structuredClone(config);
    const w = structuredClone(workflow);
    change(c, w);
    return lighthouseProblems(c, w, text);
  };
  const asserts = (c: Lhrc) => c.ci.assert?.assertions ?? {};
  expect(
    mutated((c) => {
      asserts(c)['largest-contentful-paint'] = [
        'warn',
        { maxNumericValue: 2500, aggregationMethod: 'median' },
      ];
    }),
  ).toEqual(['largest-contentful-paint does not fail above 2500']);
  expect(
    mutated((c) => {
      asserts(c)['total-byte-weight'] = [
        'error',
        { maxNumericValue: 200 * 1024, aggregationMethod: 'median' },
      ];
    }),
  ).toEqual(['total-byte-weight does not fail above 150000']);
  expect(
    mutated((c) => {
      asserts(c)['cumulative-layout-shift'] = [
        'error',
        { maxNumericValue: 0.1, aggregationMethod: 'optimistic' },
      ];
    }),
  ).toEqual(['cumulative-layout-shift is not read from the median of the runs']);
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
