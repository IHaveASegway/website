// Test-only builds of the site from the post fixtures in test/fixtures/posts/, written to .fixtures/
// and never deployed: CI uploads dist/ alone. test/writing.test.ts reads all three builds, the
// "writing fixture" Vitest project runs every dist/ check on fixture-three, and pnpm e2e:writing
// serves it (roadmap.md, PR 5).
//
//   fixture-two            2 published + 1 draft, production: Writing builds nothing
//   fixture-three          3 published + 1 draft, production: Writing renders, the draft does not
//   fixture-three-preview  the same posts with drafts included, as a pull request preview builds
//
// Each build gets the environment it needs and nothing inherited that could change it: DRAFTS is
// set or removed explicitly, and POST_FIXTURES names the set.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));

const BUILDS = [
  { name: 'fixture-two', set: 'two', drafts: false },
  { name: 'fixture-three', set: 'three', drafts: false },
  { name: 'fixture-three-preview', set: 'three', drafts: true },
];

for (const { name, set, drafts } of BUILDS) {
  const outDir = `.fixtures/${name}`;
  rmSync(join(app, outDir), { recursive: true, force: true });
  const env = { ...process.env, POST_FIXTURES: set };
  delete env.DRAFTS;
  if (drafts) env.DRAFTS = 'include';
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
