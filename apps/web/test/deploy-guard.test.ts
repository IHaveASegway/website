import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { noindexPages } from '../scripts/deploy-guard.mjs';
import { isNoindex, NOINDEX } from '../src/lib/noindex.mjs';
import { app, dist } from './support/dist';

// The deploy guard (scripts/deploy-guard.mjs): the deploy job refuses a build with any noindex page
// but the 404. Known answers on the fixture builds, whose drafts it must name,
// on small builds written here, and on how the deploy job runs it.

const script = join(app, 'scripts/deploy-guard.mjs');
const run = (dir: string) =>
  spawnSync(process.execPath, [script, dir], { cwd: app, encoding: 'utf8' });
const fixture = (name: string) => join(app, '.fixtures', name);

describe('known answers on the fixture builds', () => {
  test('a preview with a draft: exit 1, naming the draft', () => {
    const draft = 'notes/fixture-unfinished-thought/index.html';
    expect(noindexPages(fixture('fixture-many-preview'))).toEqual([draft]);
    const refused = run(fixture('fixture-many-preview'));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(draft);
  });

  test('a preview with drafts and nothing published: both drafts are named', () => {
    expect(noindexPages(fixture('fixture-none-preview'))).toEqual([
      'notes/fixture-unfinished-thought/index.html',
      'writing/fixture-draft-essay/index.html',
    ]);
  });

  test('a preview at one published post: the drafts are named, and the listed post is not', () => {
    expect(noindexPages(fixture('fixture-one-preview'))).toEqual([
      'notes/fixture-unfinished-thought/index.html',
      'writing/fixture-draft-essay/index.html',
    ]);
  });

  test('a production build passes, the 404 its one noindex page', () => {
    for (const build of [
      fixture('fixture-many'),
      fixture('fixture-one'),
      fixture('fixture-none'),
      dist,
    ]) {
      expect(noindexPages(build), build).toEqual([]);
      expect(isNoindex(readFileSync(join(build, '404.html'), 'utf8')), build).toBe(true);
      expect(run(build).status, build).toBe(0);
    }
  });
});

describe('known answers on builds written here', () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-guard-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let count = 0;
  const page = (noindex: boolean) =>
    `<!doctype html><html><head><title>x</title>${noindex ? NOINDEX : ''}</head><body></body></html>`;
  /** A build holding these files, each a page that is noindex or not. */
  function build(files: Record<string, boolean>): string {
    const dir = join(root, String(count++));
    for (const [file, noindex] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), page(noindex));
    }
    return dir;
  }

  test('only the 404 at the root may be noindex, whatever the file is called', () => {
    expect(run(build({ 'index.html': false, '404.html': true })).status).toBe(0);
    const nested = run(build({ 'index.html': false, '404.html': true, 'a/404.html': true }));
    expect(nested.status).toBe(1);
    expect(nested.stderr).toContain('a/404.html');
    const named = run(build({ 'index.html': false, 'notes/x.html': true }));
    expect(named.status).toBe(1);
    expect(named.stderr).toContain('notes/x.html');
  });

  test('a noindex Home is refused too', () => {
    expect(run(build({ 'index.html': true })).status).toBe(1);
  });

  test('exit 2 when there is no build to check: a missing directory, or one without Home', () => {
    expect(run(join(root, 'missing')).status).toBe(2);
    expect(run(build({ 'about/index.html': false })).status).toBe(2);
    expect(spawnSync(process.execPath, [script], { cwd: app }).status).toBe(2);
  });
});

test('the marker is the one Base.astro writes, and the only one any check reads', () => {
  expect(readFileSync(join(app, 'src/layouts/Base.astro'), 'utf8')).toContain(
    '<Fragment set:html={NOINDEX} />',
  );
  // The built 404 carries it byte for byte, so writer and readers agree on the bytes, not a regex.
  expect(readFileSync(join(dist, '404.html'), 'utf8')).toContain(NOINDEX);
});

test('the deploy job runs the guard on the bytes it uploads, before it uploads them', () => {
  const ci = readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8');
  const deploy = ci.slice(ci.indexOf('\n  deploy:'), ci.indexOf('\n  rollback:'));
  const guard = deploy.indexOf('run: node apps/web/scripts/deploy-guard.mjs apps/web/dist\n');
  expect(guard).toBeGreaterThan(deploy.indexOf('path: apps/web/dist'));
  expect(guard).toBeLessThan(deploy.indexOf('wrangler versions upload'));
  expect(guard).toBeLessThan(deploy.indexOf('wrangler deploy --message'));
});
