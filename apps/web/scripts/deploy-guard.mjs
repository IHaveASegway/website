// The deploy job's last line of defence for drafts (delivery.md, "Deploy, verify, roll back"). It
// refuses a build that holds any noindex page but the 404, at the boundary and independent of every
// switch upstream: production is built without drafts, and the tests check it, but this reads only
// the bytes about to be uploaded. A draft is noindex (lib/posts.ts), and production never serves
// one. The tag it looks for is lib/noindex.mjs's, the one Base.astro writes.
//
//   node apps/web/scripts/deploy-guard.mjs <build directory>
//
// Exit 0: no page but the 404 is noindex. 1: one is, and each is named. 2: the check could not run
// (no directory, or no Home page in it), which stops the deploy too: an error is never read as clean.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isNoindex } from '../src/lib/noindex.mjs';

/** The one page production ships as noindex: the 404, at the root of the build. */
const NOT_FOUND = '404.html';

/** Every HTML page in a build that says noindex, but the 404: paths relative to the build. */
export function noindexPages(dir) {
  const walk = (at) =>
    readdirSync(at).flatMap((name) => {
      const path = join(at, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(dir)
    .map((path) => relative(dir, path).split(sep).join('/'))
    .filter((file) => file.endsWith('.html') && file !== NOT_FOUND)
    .filter((file) => isNoindex(readFileSync(join(dir, file), 'utf8')))
    .sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir] = process.argv.slice(2);
  if (!dir || !existsSync(join(dir, 'index.html'))) {
    console.error(
      `deploy-guard: no build to check at ${dir ?? '(none named)'}: usage: node apps/web/scripts/deploy-guard.mjs <build directory>`,
    );
    process.exit(2);
  }
  let found;
  try {
    found = noindexPages(dir);
  } catch (error) {
    console.error(`deploy-guard: cannot check: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  if (found.length === 0) {
    console.log('deploy-guard: no page but the 404 is noindex');
    process.exit(0);
  }
  console.error(
    '::error::Not deployed: the build holds a noindex page, a draft, which production never serves.',
  );
  for (const file of found) console.error(file);
  process.exit(1);
}
