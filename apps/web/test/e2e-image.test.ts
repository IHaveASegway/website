import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { app } from './support/dist';

// The e2e job runs in Playwright's own image (delivery.md, "Actions minutes budget"): Chromium and
// its libraries come with it, so no apt install runs, and its tag is the Playwright version the
// lockfile installs, read by verify, so the browser always matches @playwright/test. Known answers
// on the workflow's text: each mutation that would bring back the drift or the install fails here.

const ci = readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8');
const job = (name: string) => {
  const start = ci.indexOf(`\n  ${name}:\n`);
  const next = ci.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return ci.slice(start, next < 0 ? undefined : start + 1 + next);
};

/** Why a job's container does not track the lockfile's Playwright, or nothing. */
export function imageProblems(workflow: { verify: string; e2e: string }): string[] {
  const problems: string[] = [];
  if (
    !/\n {4}outputs:\n {6}playwright: \$\{\{ steps\.playwright\.outputs\.version \}\}\n/.test(
      workflow.verify,
    )
  )
    problems.push('verify does not output the Playwright version');
  if (
    !workflow.verify.includes(
      `id: playwright\n        run: echo "version=$(node -p "require('./apps/web/node_modules/@playwright/test/package.json').version")" >> "$GITHUB_OUTPUT"`,
    )
  )
    problems.push('verify does not read the version from the installed @playwright/test');
  if (!/\n {4}needs: \[verify, [^\]]*\]\n/.test(workflow.e2e))
    problems.push('e2e does not need verify');
  if (
    !workflow.e2e.includes(
      '    container:\n      image: mcr.microsoft.com/playwright:v${{ needs.verify.outputs.playwright }}-noble\n      options: --user 1001\n',
    )
  )
    problems.push("e2e does not run in Playwright's image at the lockfile's version");
  if (/playwright install/.test(workflow.e2e)) problems.push('e2e installs a browser of its own');
  return problems;
}

test("e2e runs in Playwright's image, at the version verify reads from the lockfile", () => {
  expect(imageProblems({ verify: job('verify'), e2e: job('e2e') })).toEqual([]);
});

test('known answers: a pinned tag, an install step or a missing output is named', () => {
  const verify = job('verify');
  const e2e = job('e2e');
  expect(
    imageProblems({
      verify,
      e2e: e2e.replace('v${{ needs.verify.outputs.playwright }}', 'v1.64.1'),
    }),
  ).toEqual(["e2e does not run in Playwright's image at the lockfile's version"]);
  expect(
    imageProblems({
      verify,
      e2e: `${e2e}      - run: pnpm exec playwright install --with-deps chromium\n`,
    }),
  ).toEqual(['e2e installs a browser of its own']);
  expect(imageProblems({ verify: verify.replace('playwright: ${{', 'pw: ${{'), e2e })).toEqual([
    'verify does not output the Playwright version',
  ]);
  expect(imageProblems({ verify, e2e: e2e.replace('needs: [verify, ', 'needs: [') })).toEqual([
    'e2e does not need verify',
  ]);
});

test("the lockfile's Playwright has an image: the catalog pins one exact version", () => {
  const workspace = readFileSync(join(app, '../../pnpm-workspace.yaml'), 'utf8');
  expect(workspace).toMatch(/\n {2}'@playwright\/test': \d+\.\d+\.\d+\n/);
});
