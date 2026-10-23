import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { check, isStamped, stampOf, verdict } from '../scripts/review-stamp.mjs';
import { app } from './support/dist';

// The review stamp (delivery.md, "Quality gates"): a pull request that changes an entry must carry
// a stamp from a read made for it. Known answers on the rule, then on git itself, in throwaway
// repositories whose commits carry chosen dates, then on how CI runs it.

const POST = 'apps/web/src/content/writing/a-post.md';
const NOTE = 'apps/web/src/content/notes/a-note.md';
const PROFILE = 'apps/web/src/content/profile.json';
const post = (stamp: string, body: string, eol = '\n') =>
  [
    '---',
    'title: A post',
    'published: 2026-10-15',
    `firewall_reviewed: ${stamp}`,
    '---',
    '',
    body,
    '',
  ].join(eol);
const profile = (stamp: string | null, label: string) =>
  `${JSON.stringify({ basics: { label }, meta: { firewall_reviewed: stamp } }, null, 2)}\n`;

/** The base commit on 2026-10-20 and the pull request's head on 2026-10-23, both UTC. */
const DAYS = { base: '2026-10-20', head: '2026-10-23' };

describe('the rule', () => {
  const before = post('2026-10-15', 'One.');

  test('an edit with the old stamp fails, naming the file; with a new one it passes', () => {
    expect(verdict(POST, before, post('2026-10-15', 'Two.'), DAYS)).toContain(POST);
    expect(verdict(POST, before, post('2026-10-23', 'Two.'), DAYS)).toBeNull();
  });

  test("an unchanged stamp passes when it is the head commit's day: an honest same-day re-read", () => {
    const today = post('2026-10-23', 'One.');
    expect(verdict(POST, today, post('2026-10-23', 'Two.'), DAYS)).toBeNull();
  });

  test('a stamp never moves back, and is never later than the head commit', () => {
    expect(verdict(POST, before, post('2026-10-14', 'Two.'), DAYS)).toMatch(/moved back/);
    expect(verdict(POST, before, post('2026-10-14', 'One.'), DAYS)).toMatch(/moved back/);
    expect(verdict(POST, before, post('2026-10-24', 'Two.'), DAYS)).toMatch(/after the head/);
  });

  test("an added entry's stamp is on or after the base commit's day", () => {
    expect(verdict(POST, null, post('2026-10-20', 'New.'), DAYS)).toBeNull();
    expect(verdict(POST, null, post('2026-10-19', 'New.'), DAYS)).toMatch(/before the base/);
    expect(verdict(POST, null, '---\ntitle: A post\n---\n\nNew.\n', DAYS)).toMatch(/no firewall/);
  });

  test('a stamp-only change forward passes; a removed entry needs nothing', () => {
    expect(verdict(POST, before, post('2026-10-21', 'One.'), DAYS)).toBeNull();
    expect(verdict(POST, before, null, DAYS)).toBeNull();
  });

  test("profile.json's stamp is meta.firewall_reviewed, and null is no stamp", () => {
    expect(verdict(PROFILE, profile(null, 'A'), profile(null, 'B'), DAYS)).toContain(PROFILE);
    expect(
      verdict(PROFILE, profile('2026-10-15', 'A'), profile('2026-10-15', 'B'), DAYS),
    ).not.toBeNull();
    expect(verdict(PROFILE, profile(null, 'A'), profile('2026-10-23', 'B'), DAYS)).toBeNull();
  });

  test('a stamp reads the same quoted, with a comment, or with CRLF line ends', () => {
    expect(stampOf(POST, post("'2026-10-20'", 'x')).stamp).toBe('2026-10-20');
    expect(stampOf(POST, post('2026-10-20 # read twice', 'x')).stamp).toBe('2026-10-20');
    expect(stampOf(POST, post('2026-10-20', 'x', '\r\n')).stamp).toBe('2026-10-20');
    expect(stampOf(POST, 'no front matter\n').stamp).toBeNull();
  });

  test('the entries a person writes carry it, and nothing else does', () => {
    for (const path of [
      POST,
      NOTE,
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

describe('known answers on git, in throwaway repositories', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-stamp-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  let count = 0;

  /** A repository with a base commit on 2026-10-20 and a head commit on 2026-10-23 (UTC): the
   *  head writes `changes` over the base's files, and a null removes one. */
  function scenario(base: Record<string, string>, changes: Record<string, string | null>) {
    const repo = join(root, String(count++));
    mkdirSync(repo);
    const git = (date: string | null, ...args: string[]) =>
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
        {
          cwd: repo,
          env: date ? { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : env,
          encoding: 'utf8',
        },
      ).trim();
    const write = (files: Record<string, string | null>) => {
      for (const [path, text] of Object.entries(files)) {
        if (text === null) rmSync(join(repo, path));
        else {
          mkdirSync(dirname(join(repo, path)), { recursive: true });
          writeFileSync(join(repo, path), text);
        }
      }
    };
    git(null, 'init', '-q', '-b', 'main');
    write(base);
    git(null, 'add', '-A');
    git('2026-10-20T12:00:00Z', 'commit', '-q', '-m', 'base');
    const baseSha = git(null, 'rev-parse', 'HEAD');
    write(changes);
    git(null, 'add', '-A');
    git('2026-10-23T12:00:00Z', 'commit', '-q', '--allow-empty', '-m', 'head');
    return { repo, base: baseSha, head: git(null, 'rev-parse', 'HEAD') };
  }
  const problems = (s: ReturnType<typeof scenario>) => check(s.base, s.head, s.repo);
  const old = post('2026-10-15', 'One.');
  const MOVED = 'apps/web/src/content/writing/b-post.md';

  test('an edit with the old stamp fails, naming the file; with a new stamp it passes', () => {
    expect(problems(scenario({ [POST]: old }, { [POST]: post('2026-10-15', 'Two.') }))).toEqual([
      expect.stringContaining(POST),
    ]);
    expect(problems(scenario({ [POST]: old }, { [POST]: post('2026-10-23', 'Two.') }))).toEqual([]);
  });

  test("same day, stamp unchanged: passes when the stamp is the head commit's day", () => {
    const today = post('2026-10-23', 'One.');
    expect(problems(scenario({ [POST]: today }, { [POST]: post('2026-10-23', 'Two.') }))).toEqual(
      [],
    );
  });

  test('backwards fails, and a stamp later than the head commit fails', () => {
    const back = scenario({ [POST]: old }, { [POST]: post('2026-10-14', 'Two.') });
    expect(problems(back)).toEqual([expect.stringMatching(/moved back/)]);
    const future = scenario({ [POST]: old }, { [POST]: post('2026-10-24', 'Two.') });
    expect(problems(future)).toEqual([expect.stringMatching(/after the head/)]);
  });

  test('a rename (R100) is an added entry: an old stamp fails, a current one passes', () => {
    const renamed = scenario({ [POST]: old }, { [POST]: null, [MOVED]: old });
    expect(problems(renamed)).toEqual([expect.stringContaining(MOVED)]);
    const restamped = post('2026-10-23', 'One.');
    expect(problems(scenario({ [POST]: old }, { [POST]: null, [MOVED]: restamped }))).toEqual([]);
  });

  test('a rename with an edit and the old stamp fails, whatever git would call it', () => {
    const edited = scenario({ [POST]: old }, { [POST]: null, [MOVED]: post('2026-10-15', 'Two.') });
    expect(problems(edited)).toEqual([expect.stringContaining(MOVED)]);
  });

  test('a delete needs nothing; a copied post with an old stamp fails', () => {
    expect(problems(scenario({ [POST]: old, [NOTE]: old }, { [NOTE]: null }))).toEqual([]);
    expect(problems(scenario({ [POST]: old }, { [MOVED]: old }))).toEqual([
      expect.stringContaining(MOVED),
    ]);
  });

  test('CRLF line ends: the stamp is read, and the same rule holds', () => {
    const crlf = post('2026-10-15', 'One.', '\r\n');
    const stale = scenario({ [POST]: crlf }, { [POST]: post('2026-10-15', 'Two.', '\r\n') });
    expect(problems(stale)).toEqual([expect.stringContaining(POST)]);
    const fresh = scenario({ [POST]: crlf }, { [POST]: post('2026-10-23', 'Two.', '\r\n') });
    expect(problems(fresh)).toEqual([]);
  });

  test('two entries at once: each is judged, and only the failing one is named', () => {
    const both = scenario(
      { [POST]: old, [NOTE]: old },
      { [POST]: post('2026-10-15', 'Two.'), [NOTE]: post('2026-10-23', 'Two.') },
    );
    expect(problems(both)).toEqual([expect.stringContaining(POST)]);
    const neither = scenario(
      { [POST]: old, [NOTE]: old },
      { [POST]: post('2026-10-15', 'Two.'), [NOTE]: post('2026-10-15', 'Two.') },
    );
    expect(problems(neither)).toHaveLength(2);
  });

  test('the command line: exit 1 naming the file, 0 when clean, 2 when git cannot find a commit', () => {
    const script = join(app, 'scripts/review-stamp.mjs');
    const run = (s: ReturnType<typeof scenario>, ...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { cwd: s.repo, env, encoding: 'utf8' });
    const stale = scenario({ [POST]: old }, { [POST]: post('2026-10-15', 'Two.') });
    const failed = run(stale, stale.base, stale.head);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(POST);
    const fresh = scenario({ [POST]: old }, { [POST]: post('2026-10-23', 'Two.') });
    expect(run(fresh, fresh.base, fresh.head).status).toBe(0);
    // The head's day can come from another commit: CI compares the merge, dated by the PR's head.
    expect(run(fresh, fresh.base, fresh.head, fresh.base).status).toBe(1);
    expect(run(fresh, fresh.base, 'f'.repeat(40)).status).toBe(2);
  });
});

test("CI runs it on every pull request, against the merge's base, dated by the PR's head", () => {
  const ci = readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8');
  const verify = ci.slice(ci.indexOf('\n  verify:'), ci.indexOf('\n  firewall:'));
  expect(verify).toContain('fetch-depth: 2');
  expect(verify).toMatch(
    /- name: Review stamp[^\n]*\n\s+if: github\.event_name == 'pull_request'\n\s+run: node apps\/web\/scripts\/review-stamp\.mjs HEAD\^1 HEAD HEAD\^2\n/,
  );
});
