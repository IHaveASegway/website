import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { app } from './support/dist';

// scripts/check-hooks.sh, the postinstall warning that the firewall's hooks are off (security.md,
// "Local parity"): known answers on a throwaway clone. The hooks are on when core.hooksPath is
// .githooks, or names a directory that holds this checkout's hooks byte for byte, each runnable,
// and nothing else, as a worktree's does: its clone's .githooks by an absolute path. Anything else
// warns: unset, another directory, a missing, extra, different or unrunnable hook. A check that
// only ever passed would prove nothing, and one that warned in every worktree, as it did until
// 2026-10-31, taught people to skip it.

const script = join(app, '../../scripts/check-hooks.sh');
const hooks = join(app, '../../.githooks');
const root = mkdtempSync(join(tmpdir(), 'check-hooks-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const home = join(root, 'home');
const clone = join(root, 'clone');
const env = {
  PATH: process.env['PATH'] ?? '',
  HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

/** A directory holding a copy of the checkout's hooks, each runnable. */
function copyOfHooks(dir: string): string {
  mkdirSync(dir, { recursive: true });
  for (const name of ['pre-commit', 'pre-push']) {
    copyFileSync(join(hooks, name), join(dir, name));
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

/** Whether the script warns, run as postinstall runs it, in `cwd`, with core.hooksPath `path`. */
function warns(path: string | null, cwd = clone): boolean {
  if (path === null) spawnSync('git', ['config', '--unset', 'core.hooksPath'], { cwd, env });
  else git(cwd, 'config', 'core.hooksPath', path);
  const result = spawnSync('sh', [script], { cwd, env, encoding: 'utf8' });
  expect(result.status).toBe(0); // it never fails the install
  return result.stderr.includes('hooks are OFF');
}

mkdirSync(home);
git(root, 'init', '-q', '-b', 'main', clone);
copyOfHooks(join(clone, '.githooks'));
writeFileSync(join(clone, 'README.md'), 'One.\n');
git(clone, 'add', '-A');
git(clone, 'commit', '-qm', 'One', '--no-gpg-sign');

describe('known answers', () => {
  test('on: .githooks, as README.md sets it', () => {
    expect(warns('.githooks')).toBe(false);
  });

  test('on: the same hooks by an absolute path, a relative one, or from home', () => {
    expect(warns(join(clone, '.githooks'))).toBe(false);
    expect(warns(copyOfHooks(join(root, 'elsewhere')))).toBe(false);
    copyOfHooks(join(clone, 'tools/hooks'));
    expect(warns('tools/hooks')).toBe(false);
    copyOfHooks(join(home, 'hooks'));
    expect(warns('~/hooks')).toBe(false);
  });

  test("on: a worktree, whose hooksPath is its clone's .githooks by an absolute path", () => {
    const tree = join(root, 'tree');
    git(clone, 'worktree', 'add', '-q', '-b', 'tree', tree);
    expect(warns(join(clone, '.githooks'), tree)).toBe(false);
  });

  test('off: unset, a directory that is not there, or one with no hooks', () => {
    expect(warns(null)).toBe(true);
    expect(warns(join(root, 'nowhere'))).toBe(true);
    mkdirSync(join(root, 'empty'));
    expect(warns(join(root, 'empty'))).toBe(true);
  });

  test('off: a hook missing, one more, one that differs, or one git cannot run', () => {
    const missing = copyOfHooks(join(root, 'missing'));
    rmSync(join(missing, 'pre-push'));
    expect(warns(missing)).toBe(true);

    const extra = copyOfHooks(join(root, 'extra'));
    writeFileSync(join(extra, 'post-checkout'), '#!/bin/sh\n');
    expect(warns(extra)).toBe(true);

    const differs = copyOfHooks(join(root, 'differs'));
    writeFileSync(join(differs, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    expect(warns(differs)).toBe(true);

    const stopped = copyOfHooks(join(root, 'stopped'));
    chmodSync(join(stopped, 'pre-commit'), 0o644);
    expect(warns(stopped)).toBe(true);
  });

  test('off in a worktree whose hooksPath names hooks that differ from its own', () => {
    const tree = join(root, 'tree-differs');
    git(clone, 'worktree', 'add', '-q', '-b', 'tree-differs', tree);
    writeFileSync(join(tree, '.githooks/pre-push'), '#!/bin/sh\nexit 0\n');
    expect(warns(join(clone, '.githooks'), tree)).toBe(true);
  });
});
