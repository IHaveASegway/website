import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { parse } from 'yaml';
import { app } from './support/dist';

// The firewall self-test's place in the job graph (delivery.md, "Pipeline"; ADR 0006, postscript
// of 2026-10-31). It runs in a job of its own beside verify, so these hold the three things that
// keep its meaning: deploy needs it, a push to main skips only its step and never the job, and a
// pull request that changes the scanner publishes no preview before the self-test has proved it.
// Then known answers for scanner-changed.sh, which both decisions read, in a throwaway repository.

interface Step {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
}
interface Job {
  if?: string;
  needs?: string | string[];
  steps?: Step[];
}
type Workflow = { jobs: Record<string, Job> };

const workflow = parse(
  readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8'),
) as Workflow;
const job = (name: string) => workflow.jobs[name] ?? { steps: [] };
const needs = (j: Job) => (typeof j.needs === 'string' ? [j.needs] : (j.needs ?? []));
const SELFTEST = 'scripts/firewall/test.sh';

test('deploy needs verify, firewall and the self-test, and verify no longer runs it', () => {
  expect(needs(job('deploy'))).toEqual(
    expect.arrayContaining(['verify', 'firewall', 'firewall-selftest']),
  );
  expect(job('verify').steps?.some((s) => s.run?.includes(SELFTEST))).toBe(false);
});

test('the self-test job always reports: only its step depends on what changed', () => {
  const j = job('firewall-selftest');
  // A job skipped by its own if: reports "skipped", which a needs: would not wait for as a pass.
  expect(j.if).toBe("github.event_name != 'workflow_dispatch'");
  expect(needs(j)).toEqual([]);
  const scope = j.steps?.find((s) => s.id === 'scope');
  // Every event but a push runs it, and a push asks the script.
  expect(scope?.run).toMatch(/^run=true\n/);
  expect(scope?.run).toContain('if [ "$EVENT" = push ]; then');
  expect(scope?.run).toContain('scripts/firewall/scanner-changed.sh "$BEFORE" HEAD');
  const selftest = j.steps?.find((s) => s.run === SELFTEST);
  expect(selftest?.if).toBe("steps.scope.outputs.run == 'true'");
});

test('a pull request that changes the scanner publishes no preview', () => {
  const steps = job('preview').steps ?? [];
  const scanner = steps.findIndex((s) => s.id === 'scanner');
  const publish = steps.findIndex((s) => s.id === 'publish');
  expect(scanner).toBeGreaterThanOrEqual(0);
  expect(steps[scanner]?.run).toContain('scripts/firewall/scanner-changed.sh HEAD^1 HEAD');
  expect(publish).toBeGreaterThan(scanner);
  expect(steps[publish]?.if).toBe("steps.scanner.outputs.changed != 'true'");
});

const root = mkdtempSync(join(tmpdir(), 'scanner-changed-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('scanner-changed.sh: known answers, and every unknown runs the self-test', () => {
  const script = join(app, '../../scripts/firewall/scanner-changed.sh');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const commit = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
    git('add', '-A');
    git('commit', '-qm', `Change ${path}`, '--no-gpg-sign');
    return git('rev-parse', 'HEAD');
  };
  const changed = (...args: string[]) =>
    execFileSync(script, args, { cwd: root, env, encoding: 'utf8' }).trim();

  git('init', '-q', '-b', 'main', '.');
  const first = commit('README.md', 'One.\n');
  commit('.github/workflows/ci.yml', 'name: ci\n');
  const content = commit('README.md', 'Two.\n');
  const check = commit('scripts/firewall/check.sh', '#!/bin/sh\n');
  const pin = commit('scripts/firewall/gitleaks.version', 'version=1\n');
  const workflowEdit = commit('.github/workflows/ci.yml', 'name: ci, edited\n');

  expect(changed(`${content}^`, content)).toBe('false'); // content only
  expect(changed(`${check}^`, check)).toBe('true'); // check.sh
  expect(changed(`${pin}^`, pin)).toBe('true'); // the pinned gitleaks version
  expect(changed(`${workflowEdit}^`, workflowEdit)).toBe('true'); // the workflow
  expect(changed(first, content)).toBe('true'); // a range that holds a workflow change
  expect(changed(check, check)).toBe('false'); // nothing at all
  expect(changed('0'.repeat(40), content)).toBe('true'); // a new branch: no previous commit
  expect(changed('', content)).toBe('true'); // no base given
  expect(changed('f'.repeat(40), content)).toBe('true'); // a base this clone does not hold
  expect(changed(first, 'f'.repeat(40))).toBe('true'); // a head it cannot read
});
