import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { check, isStamped, stampOf, verdict } from '../scripts/review-stamp.mjs';
import { app } from './support/dist';

// The review stamp (delivery.md, "Quality gates"): a pull request that changes an entry, anything
// in it but its firewall_reviewed date, must change that date too. Known answers on the rule, then
// on git itself, in a throwaway repository.

const POST = 'apps/web/src/content/writing/a-post.md';
const PROFILE = 'apps/web/src/content/profile.json';
const post = (stamp: string, body: string) =>
  `---\ntitle: A post\npublished: 2026-10-20\nfirewall_reviewed: ${stamp}\n---\n\n${body}\n`;
const profile = (stamp: string | null, label: string) =>
  `${JSON.stringify({ basics: { label }, meta: { firewall_reviewed: stamp } }, null, 2)}\n`;

describe('the rule', () => {
  test('an edited body with an unchanged stamp fails, and the message names the file', () => {
    const problem = verdict(POST, post('2026-10-20', 'One.'), post('2026-10-20', 'Two.'));
    expect(problem).toContain(POST);
    expect(problem).toContain('firewall_reviewed');
  });

  test('the same edit with a new stamp passes', () => {
    expect(verdict(POST, post('2026-10-20', 'One.'), post('2026-10-23', 'Two.'))).toBeNull();
  });

  test('a change to the stamp alone passes', () => {
    expect(verdict(POST, post('2026-10-20', 'One.'), post('2026-10-23', 'One.'))).toBeNull();
  });

  test('a front matter edit counts as an edit, and an edit that drops the stamp never passes', () => {
    const before = post('2026-10-20', 'One.');
    expect(verdict(POST, before, before.replace('title: A post', 'title: B post'))).not.toBeNull();
    const unstamped = post('2026-10-20', 'Two.').replace(/firewall_reviewed.*\n/, '');
    expect(verdict(POST, before, unstamped)).not.toBeNull();
  });

  test('a new entry needs a stamp; a removed one needs nothing', () => {
    expect(verdict(POST, null, post('2026-10-23', 'New.'))).toBeNull();
    expect(verdict(POST, null, '---\ntitle: A post\n---\n\nNew.\n')).not.toBeNull();
    expect(verdict(POST, post('2026-10-20', 'Gone.'), null)).toBeNull();
  });

  test("profile.json's stamp is meta.firewall_reviewed, and null is no stamp", () => {
    expect(verdict(PROFILE, profile(null, 'A'), profile(null, 'B'))).toContain(PROFILE);
    expect(verdict(PROFILE, profile('2026-10-20', 'A'), profile('2026-10-20', 'B'))).not.toBeNull();
    expect(verdict(PROFILE, profile(null, 'A'), profile('2026-10-23', 'B'))).toBeNull();
    expect(verdict(PROFILE, profile('2026-10-20', 'A'), profile('2026-10-23', 'A'))).toBeNull();
  });

  test('a stamp reads the same quoted or with a comment, and nothing else is a stamp', () => {
    expect(stampOf(POST, post("'2026-10-20'", 'x')).stamp).toBe('2026-10-20');
    expect(stampOf(POST, post('2026-10-20 # read twice', 'x')).stamp).toBe('2026-10-20');
    expect(stampOf(POST, 'no front matter\n').stamp).toBeNull();
  });

  test('the entries a person writes carry it, and nothing else does', () => {
    for (const path of [
      POST,
      'apps/web/src/content/notes/a-note.md',
      'apps/web/src/content/work/a-case.mdx',
      'apps/web/src/content/lab/a-demo.md',
      'apps/web/src/content/now.md',
      PROFILE,
    ]) {
      expect(isStamped(path), path).toBe(true);
    }
    for (const path of [
      'apps/web/src/content/writing/sub/a.md',
      'apps/web/test/fixtures/posts/three/writing/fixture-measure-first.md',
      'apps/web/src/lib/posts.ts',
      'docs/content.md',
    ]) {
      expect(isStamped(path), path).toBe(false);
    }
  });
});

describe('known answers on git, in a throwaway repository', () => {
  const repo = mkdtempSync(join(tmpdir(), 'review-stamp-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'commit.gpgSign=false',
        ...args,
      ],
      { cwd: repo, env, encoding: 'utf8' },
    ).trim();
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const base = commit(
    { [POST]: post('2026-10-20', 'One.'), [PROFILE]: profile(null, 'A') },
    'base',
  );
  const edited = commit({ [POST]: post('2026-10-20', 'Two.') }, 'edit, no stamp');
  const stamped = commit({ [POST]: post('2026-10-23', 'Two.') }, 'stamp');
  const renamed = commit(
    { 'apps/web/src/content/writing/b-post.md': post('2026-10-23', 'Two.') },
    'copy',
  );
  const script = join(app, 'scripts/review-stamp.mjs');
  const run = (from: string, to: string) =>
    spawnSync(process.execPath, [script, from, to], { cwd: repo, env, encoding: 'utf8' });

  test('an edit with no new stamp fails, exit 1, naming the file', () => {
    expect(check(base, edited, repo)).toEqual([expect.stringContaining(POST)]);
    const result = run(base, edited);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(POST);
  });

  test('the same edit with a new stamp passes, exit 0', () => {
    expect(check(base, stamped, repo)).toEqual([]);
    expect(run(base, stamped).status).toBe(0);
  });

  test('a stamp-only change passes, and so does a new entry that has one', () => {
    expect(check(edited, stamped, repo)).toEqual([]);
    expect(check(stamped, renamed, repo)).toEqual([]);
  });

  test('a commit git cannot find is exit 2, never a pass', () => {
    expect(run(base, 'f'.repeat(40)).status).toBe(2);
  });
});
