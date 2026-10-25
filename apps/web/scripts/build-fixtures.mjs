// Test-only builds of the site from the post fixtures in test/fixtures/posts/, written to .fixtures/
// and never deployed: CI uploads dist/ or dist-preview/ alone. test/writing.test.ts reads them all,
// test/superset.test.ts holds each production build to its preview (ADR 0015), vitest.config.ts runs
// every check over a build on four of them, and pnpm e2e:writing serves fixture-many (roadmap.md,
// PR 5).
//
//   fixture-none           2 drafts and nothing published, production: Writing builds nothing
//   fixture-none-preview   the same, drafts included: the 2 draft pages, and Home without Writing
//   fixture-none-node-env  fixture-none again under NODE_ENV=development: still no draft
//   fixture-one            1 published + 2 drafts, production: Writing renders, at the minimum
//   fixture-one-preview    the same, drafts included: a draft's link to the listed post resolves
//   fixture-many           5 published + a draft, production: Home lists 3, the indexes all 5
//   fixture-many-preview   the same, drafts included, as a pull request preview builds them
//
// The two fixture-many builds also take PROFILE_FIXTURE=resume: one made-up project, checked and
// held by nothing, is appended to the real profile's projects, so its card and repository link
// render and meet every check over a build; and ten made-up roles and twelve skills, the schema's
// limits, are appended too, so the résumé's Experience and Skills render, and print on one page,
// before any real entry exists (test/fixtures/profile/resume.json).
//
// Each build gets the environment it needs and nothing inherited that could change it: DRAFTS and
// NODE_ENV are set or removed explicitly, POST_FIXTURES names the set, and PROFILE_FIXTURE is set
// or removed the same way.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));

const BUILDS = [
  { name: 'fixture-none', set: 'none', drafts: false },
  { name: 'fixture-none-preview', set: 'none', drafts: true },
  { name: 'fixture-none-node-env', set: 'none', drafts: false, nodeEnv: 'development' },
  { name: 'fixture-one', set: 'one', drafts: false },
  { name: 'fixture-one-preview', set: 'one', drafts: true },
  { name: 'fixture-many', set: 'many', drafts: false, profile: 'resume' },
  { name: 'fixture-many-preview', set: 'many', drafts: true, profile: 'resume' },
];

for (const { name, set, drafts, nodeEnv, profile } of BUILDS) {
  const outDir = `.fixtures/${name}`;
  rmSync(join(app, outDir), { recursive: true, force: true });
  const env = { ...process.env, POST_FIXTURES: set, DRAFTS: drafts ? 'include' : 'exclude' };
  delete env.NODE_ENV;
  if (nodeEnv) env.NODE_ENV = nodeEnv;
  delete env.PROFILE_FIXTURE;
  if (profile) env.PROFILE_FIXTURE = profile;
  const result = spawnSync('pnpm', ['exec', 'astro', 'build', '--outDir', outDir], {
    cwd: app,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '');
    console.error(`build-fixtures: ${name} failed (status ${result.status})`);
    process.exit(1);
  }
  console.log(`build-fixtures: ${name} written to apps/web/${outDir}`);
}
