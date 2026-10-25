import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { app } from './support/dist';

// e2e, lighthouse and prod-smoke run in Playwright's own image (delivery.md, "Actions minutes budget"):
// Chromium and its libraries come with it, so no apt install runs, and its tag is the Playwright
// version the lockfile installs, which verify reads (and the rollback job, when no build ran), so
// the browser always matches @playwright/test. The verdict on production and the incident issue
// stay on the runner, which has gh, with the run's only issues: write token. A failed smoke fails
// prod-smoke, so a re-run of failed jobs checks production again rather than judging old outputs,
// and prod-smoke saves no cache: it runs on main, whose caches every pull request restores. Known
// answers on the workflow, parsed: each mutation that brings back one of these fails.

interface Step {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: unknown;
}
interface Job {
  if?: string;
  needs?: string[];
  container?: { image?: string; options?: string };
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps?: Step[];
}
type Workflow = { jobs: Record<string, Job> };

const IMAGE = 'mcr.microsoft.com/playwright:v';
const READS_VERSION =
  'version="$(node -p "require(\'./apps/web/node_modules/@playwright/test/package.json\').version")"';

/** Why the browser jobs do not run in the lockfile's image, or the tokens sit wrong, one line each. */
export function imageProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  const {
    verify,
    rollback,
    e2e,
    lighthouse,
    deploy,
    'prod-smoke': smoke,
    'prod-verdict': verdict,
  } = workflow.jobs;
  for (const [name, job] of [
    ['verify', verify],
    ['rollback', rollback],
  ] as const) {
    const step = job?.steps?.find((s) => s.id === 'playwright');
    if (
      job?.outputs?.['playwright']?.trim().split(' #')[0] !==
      '${{ steps.playwright.outputs.version }}'
    )
      problems.push(`${name} does not output the Playwright version`);
    if (
      !step?.run?.includes(READS_VERSION) ||
      !step.run.includes("grep -Eqx '[0-9]+\\.[0-9]+\\.[0-9]+'")
    )
      problems.push(
        `${name} does not read and check the version of the installed @playwright/test`,
      );
  }
  const images: [string, Job | undefined, string, readonly string[]][] = [
    ['e2e', e2e, `${IMAGE}\${{ needs.verify.outputs.playwright }}-noble`, ['verify']],
    ['lighthouse', lighthouse, `${IMAGE}\${{ needs.verify.outputs.playwright }}-noble`, ['verify']],
    [
      'prod-smoke',
      smoke,
      `${IMAGE}\${{ needs.verify.outputs.playwright || needs.rollback.outputs.playwright }}-noble`,
      ['verify', 'rollback'],
    ],
  ];
  for (const [name, job, image, needs] of images) {
    if (job?.container?.image !== image || job.container.options !== '--user 1001')
      problems.push(`${name} does not run in Playwright's image at the lockfile's version`);
    if (!needs.every((need) => job?.needs?.includes(need)))
      problems.push(`${name} does not need ${needs.join(' and ')}`);
    if (job?.steps?.some((s) => /playwright install|install-deps|apt-get/.test(s.run ?? '')))
      problems.push(`${name} installs a browser of its own`);
  }
  // The image jobs' GITHUB_TOKEN reads contents only; the issues token stays on the runner. (The
  // runtime token for caches and artifacts is not one permissions: governs: security.md.)
  if (JSON.stringify(smoke?.permissions) !== JSON.stringify({ contents: 'read' }))
    problems.push('prod-smoke holds more than contents: read');
  if (smoke?.steps?.some((s) => s['continue-on-error'] !== undefined))
    problems.push('a prod-smoke step continues on error, so a re-run of failed jobs skips it');
  if (
    /needs\.prod-smoke\.outputs/.test(verdict?.if ?? '') ||
    !/needs\.prod-smoke\.result == 'failure'/.test(verdict?.if ?? '')
  )
    problems.push("prod-verdict's if reads more than this attempt's prod-smoke result");
  const node = smoke?.steps?.find((s) => s.uses?.startsWith('actions/setup-node'));
  if (node?.with?.['cache'] !== undefined || node?.with?.['package-manager-cache'] !== false)
    problems.push('prod-smoke saves a cache on main from inside the image');
  if (verdict?.container || verdict?.permissions?.['issues'] !== 'write')
    problems.push('prod-verdict is not the runner job with issues: write');
  if (!verdict?.needs?.includes('prod-smoke'))
    problems.push('prod-verdict does not need prod-smoke');
  if (!deploy?.steps?.some((s) => s.run?.includes('pnpm run smoke')))
    problems.push('deploy does not smoke the Version URL');
  return problems;
}

const workflow = parse(
  readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8'),
) as Workflow;

test("e2e, lighthouse and prod-smoke run in Playwright's image, at the version the lockfile installs", () => {
  expect(imageProblems(workflow)).toEqual([]);
});

test('known answers: a pinned tag, an install, a missing output or a token in the image is named', () => {
  const mutated = (change: (w: Workflow) => void) => {
    const copy = structuredClone(workflow);
    change(copy);
    return imageProblems(copy);
  };
  const job = (w: Workflow, name: string) => {
    const found = w.jobs[name];
    if (!found) throw new Error(`no ${name} job`);
    return found;
  };
  expect(
    mutated((w) => {
      job(w, 'e2e').container = { image: `${IMAGE}1.64.1-noble`, options: '--user 1001' };
    }),
  ).toEqual(["e2e does not run in Playwright's image at the lockfile's version"]);
  expect(
    mutated((w) => {
      job(w, 'prod-smoke').steps?.push({
        run: 'pnpm exec playwright install --with-deps chromium',
      });
    }),
  ).toEqual(['prod-smoke installs a browser of its own']);
  expect(
    mutated((w) => {
      delete job(w, 'rollback').outputs;
    }),
  ).toEqual(['rollback does not output the Playwright version']);
  expect(
    mutated((w) => {
      const step = job(w, 'verify').steps?.find((s) => s.id === 'playwright');
      if (step) step.run = `echo "version=$(node -p 1)" >> "$GITHUB_OUTPUT"`;
    }),
  ).toEqual(['verify does not read and check the version of the installed @playwright/test']);
  expect(
    mutated((w) => {
      job(w, 'prod-smoke').permissions = { contents: 'read', issues: 'write' };
    }),
  ).toEqual(['prod-smoke holds more than contents: read']);
  expect(
    mutated((w) => {
      job(w, 'prod-smoke').needs = ['deploy', 'rollback'];
    }),
  ).toEqual(['prod-smoke does not need verify and rollback']);
  // The regression the split brought: a smoke that continues on error leaves prod-smoke green, so
  // "Re-run failed jobs" re-ran prod-verdict alone, on the first attempt's outputs.
  expect(
    mutated((w) => {
      const step = job(w, 'prod-smoke').steps?.find((s) => s.id === 'smoke');
      if (step) step['continue-on-error'] = true;
    }),
  ).toEqual(['a prod-smoke step continues on error, so a re-run of failed jobs skips it']);
  expect(
    mutated((w) => {
      job(w, 'prod-verdict').if =
        "${{ !cancelled() && (needs.prod-smoke.result == 'failure' || needs.prod-smoke.outputs.smoke == 'failure') }}";
    }),
  ).toEqual(["prod-verdict's if reads more than this attempt's prod-smoke result"]);
  expect(
    mutated((w) => {
      const node = job(w, 'prod-smoke').steps?.find((s) =>
        s.uses?.startsWith('actions/setup-node'),
      );
      if (node) node.with = { 'node-version-file': '.nvmrc', cache: 'pnpm' };
    }),
  ).toEqual(['prod-smoke saves a cache on main from inside the image']);
});

test("the lockfile's Playwright has an image: the catalog pins one exact version", () => {
  const workspace = readFileSync(join(app, '../../pnpm-workspace.yaml'), 'utf8');
  expect(workspace).toMatch(/\n {2}'@playwright\/test': \d+\.\d+\.\d+\n/);
});
