// Test-only builds of the site from the post fixtures in test/fixtures/posts/, written to .fixtures/
// and never deployed: CI uploads dist/ or dist-preview/ alone. test/writing.test.ts reads them all,
// test/superset.test.ts holds each production build to its preview (ADR 0015), vitest.config.ts runs
// every check over a build on three of them, and pnpm e2e:writing serves fixture-many (roadmap.md,
// PR 5).
//
//   fixture-two            2 published + a draft, production: Writing builds nothing
//   fixture-two-preview    the same, drafts included: the 2 posts unlisted, and the draft
//   fixture-two-node-env   fixture-two again under NODE_ENV=development: still no draft
//   fixture-three          3 published + a draft, production: Writing renders, at the minimum
//   fixture-three-preview  the same, drafts included: every set's draft renders in some build
//   fixture-many           5 published + a draft, production: Home lists 3, the indexes all 5
//   fixture-many-preview   the same, drafts included, as a pull request preview builds them
//
// The two fixture-many builds also take PROFILE_FIXTURE=card: one made-up project, checked and held
// by nothing, is appended to the real profile's projects, so its card and repository link render
// and meet every check over a build (test/fixtures/profile/card.json).
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
  { name: 'fixture-two', set: 'two', drafts: false },
  { name: 'fixture-two-preview', set: 'two', drafts: true },
  { name: 'fixture-two-node-env', set: 'two', drafts: false, nodeEnv: 'development' },
  { name: 'fixture-three', set: 'three', drafts: false },
  { name: 'fixture-three-preview', set: 'three', drafts: true },
  { name: 'fixture-many', set: 'many', drafts: false, profile: 'card' },
  { name: 'fixture-many-preview', set: 'many', drafts: true, profile: 'card' },
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
