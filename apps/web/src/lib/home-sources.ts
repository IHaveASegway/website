import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decisionOf, testsIn, type Decision } from './home';

// The records Home's figures count, read at build (lib/home.ts holds the rules). Astro's root is
// the working directory, apps/web, as lib/route-lab/node-solver.ts says, so the repository's other
// folders are found from it. A record that cannot be read gives nothing, and Home leaves out what
// it would have shown, never a guess.

const root = () => process.cwd();

/** Every decision record in docs/adr/, in number order. */
export function readDecisions(dir = resolve(root(), '../../docs/adr')): Decision[] {
  try {
    return readdirSync(dir)
      .filter((name) => /^\d{4}-.+\.md$/.test(name))
      .sort()
      .flatMap((name) => {
        const decision = decisionOf(readFileSync(join(dir, name), 'utf8'));
        return decision ? [decision] : [];
      });
  } catch {
    return [];
  }
}

/** The test declarations in the site's unit tests (test/) and browser tests (e2e/). */
export function countTests(dirs = ['test', 'e2e'].map((d) => resolve(root(), d))): number {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === 'fixtures'
          ? []
          : walk(join(dir, entry.name))
        : /\.(spec|test)\.ts$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    );
  try {
    return dirs.flatMap(walk).reduce((n, file) => n + testsIn(readFileSync(file, 'utf8')), 0);
  } catch {
    return 0;
  }
}

/**
 * Each commit's day in the repository's history, in UTC, one entry a commit: the activity calendar's
 * record. None from a shallow clone, whose history is cut short and would draw a false calendar: CI's
 * build checks out the whole history (.github/workflows/ci.yml, fetch-depth 0).
 */
export function readCommitDays(cwd = root()): string[] {
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
    if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') return [];
    return git(['log', '--format=%cd', '--date=format-local:%Y-%m-%d'])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
